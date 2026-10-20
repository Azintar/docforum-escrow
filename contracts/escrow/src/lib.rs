// Soroban escrow contract.
//
// Phase E1 (see ROADMAP.md): create_escrow, get_status.
// Phase E2: release, refund. Both restricted to the escrow's `releaser`
// address, set at create_escrow time — see docs/adr/0002 for why a
// per-escrow releaser was chosen over a single contract-level admin.
// Phase E4 (issue #11): optional `refund_after` timeout refund — see
// docs/adr/0004. After that deadline anyone may refund, but only back to
// the payer, so a lost `releaser` key can no longer lock funds forever.
// Phase E5 (issue #30): optional protocol fee (`fee_recipient` +
// `fee_bps`, one off-the-top cut), fixed at creation and taken at
// release — see docs/adr/0005. Never taken on refund.
//
// Hard rule (see ARCHITECTURE_ESSENTIALS.md / docs/adr/0001): the contract
// enforces WHO may act, not WHY. `condition_ref` is opaque — the contract
// never interprets it. Keep it that way; domain logic belongs in the
// consuming application (docforum-core), never here.
#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Funded,
    Released,
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowData {
    pub payer: Address,
    pub payee: Address,
    pub token: Address,
    pub amount: i128,
    pub condition_ref: String,
    pub status: EscrowStatus,
    /// The only address permitted to call `release`/`refund` on this
    /// escrow. Set once at `create_escrow` time — see docs/adr/0002.
    pub releaser: Address,
    /// Optional deadline (unix seconds) after which `refund` opens to
    /// anyone — still only back to `payer`. `None` means no timeout,
    /// behaviour identical to before this field existed — see docs/adr/0004.
    pub refund_after: Option<u64>,
    /// Optional protocol fee, set once at `create_escrow` time and taken
    /// at release (never on refund) — see docs/adr/0005. Stored as one
    /// (recipient, bps) pair in two fields so both are always set together
    /// or not at all (creation-time rule, `InvalidFee` otherwise); a
    /// partially-set pair can never be read back from an escrow that
    /// exists. `None` bps (with no recipient) means no fee: the payee
    /// receives the full `amount`, exactly as before this existed.
    pub fee_recipient: Option<Address>,
    /// Fee rate in basis points of `amount` (capped at [`MAX_FEE_BPS`]
    /// = 10 %), taken once at release, rounded **down** with the
    /// remainder to the payee — see docs/adr/0005 (decisions 2 and 3).
    pub fee_bps: Option<u32>,
}

/// Maximum `Fee::bps`: 1 000 basis points out of [`BASIS_POINTS`] 10 000
/// = 10 %. A platform fee fixed at creation must be transparent but
/// cannot be the arrangement itself — see docs/adr/0005 (decision 2).
pub const MAX_FEE_BPS: u32 = 1_000;
/// 10 000 basis points = 100 %.
const BASIS_POINTS: i128 = 10_000;

#[contracttype]
enum DataKey {
    Escrow(u64),
    NextId,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    InvalidAmount = 2,
    Unauthorized = 3,
    NotFunded = 4,
    /// `refund_after` was not strictly in the future at creation — see
    /// docs/adr/0004: a deadline that has already passed would let
    /// anyone refund the escrow before the releaser could ever act.
    InvalidRefundAfter = 5,
    /// The contract's token balance didn't rise by exactly `amount`
    /// across `create_escrow`'s transfer (a lying or short-delivering
    /// token) — see docs/threat-model.md T5.
    BalanceMismatch = 6,
    /// The optional fee was misconfigured at creation: `bps` above
    /// [`MAX_FEE_BPS`] (10 %), a recipient equal to the escrow contract
    /// itself, or an amount that would overflow the fee math — see
    /// docs/adr/0005 (decisions 2, 3 and 5).
    InvalidFee = 7,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Locks `amount` of `token` pulled from `payer`, held for `payee`,
    /// tagged with an opaque `condition_ref`. `releaser` is the only
    /// address that will later be permitted to call `release`/`refund`
    /// on this escrow (see docs/adr/0002). `refund_after` is an optional
    /// unix timestamp after which `refund` opens to any caller, always
    /// back to `payer` (docs/adr/0004); `None` means no timeout.
    /// `fee_recipient`/`fee_bps` are the optional protocol fee, fixed
    /// at creation and taken at release — never on refund — to a
    /// recipient other than the contract itself, with `fee_bps ≤`
    /// [`MAX_FEE_BPS`] (10 %) and floor rounding; both are given
    /// together or not at all (docs/adr/0005). `None` on both means no
    /// fee.
    /// Requires `payer` auth (the contract moves their funds). Returns
    /// the new escrow's id.
    pub fn create_escrow(
        env: Env,
        payer: Address,
        payee: Address,
        token: Address,
        amount: i128,
        condition_ref: String,
        releaser: Address,
        refund_after: Option<u64>,
        fee_recipient: Option<Address>,
        fee_bps: Option<u32>,
    ) -> Result<u64, Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if let Some(deadline) = refund_after {
            if deadline <= env.ledger().timestamp() {
                return Err(Error::InvalidRefundAfter);
            }
        }
        match (&fee_recipient, &fee_bps) {
            // No fee — the fee-free path behaves exactly as before this
            // parameter existed (docs/adr/0005).
            (None, None) => {}
            // A fee is one (recipient, bps) pair fixed at creation; a
            // recipient without a rate or a rate without a recipient is
            // not a coherent configuration — reject it (docs/adr/0005,
            // decision 1).
            (Some(_), None) | (None, Some(_)) => return Err(Error::InvalidFee),
            (Some(recipient), Some(bps)) => {
                if *bps > MAX_FEE_BPS {
                    return Err(Error::InvalidFee);
                }
                // A self-directed fee is pure misconfiguration: funds
                // paid to this contract's own address sit outside any
                // escrow and are unrecoverable by every path it offers
                // — see docs/adr/0005 (decision 5).
                if *recipient == env.current_contract_address() {
                    return Err(Error::InvalidFee);
                }
                // Compute the fee now, before locking any funds, so an
                // overflow in the fee math fails creation instead of
                // the later release (docs/adr/0005, decision 3).
                Self::fee_amount(amount, *bps)?;
            }
        }
        payer.require_auth();

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        let balance_before = token_client.balance(&contract_address);
        token_client.transfer(&payer, &contract_address, &amount);
        let balance_after = token_client.balance(&contract_address);
        if balance_after.checked_sub(balance_before) != Some(amount) {
            return Err(Error::BalanceMismatch);
        }

        let id = Self::next_id(&env);
        let data = EscrowData {
            payer,
            payee,
            token,
            amount,
            condition_ref,
            status: EscrowStatus::Funded,
            releaser,
            refund_after,
            fee_recipient,
            fee_bps,
        };
        env.storage().persistent().set(&DataKey::Escrow(id), &data);
        Ok(id)
    }

    /// Read-only status query. Errors if `escrow_id` doesn't exist.
    pub fn get_status(env: Env, escrow_id: u64) -> Result<EscrowStatus, Error> {
        let data: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::NotFound)?;
        Ok(data.status)
    }

    /// Read-only accessor for everything stored about `escrow_id` —
    /// payer, payee, token, amount, `condition_ref`, status, `releaser`,
    /// `refund_after` and the optional fee (`fee_recipient`/`fee_bps`,
    /// exactly as declared at creation). Exists so payees and integrators
    /// can check the deadline — and both parties the exact fee — before
    /// relying on a `Funded` escrow (docs/adr/0004, threat model T8;
    /// docs/adr/0005). Errors on an unknown id.
    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<EscrowData, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::NotFound)
    }

    /// Moves the escrowed `amount` to `payee`. Only the escrow's
    /// `releaser` (set at `create_escrow` time) may call this — the
    /// contract enforces WHO, never WHY (ADR 0001). Errors if the
    /// escrow doesn't exist, `caller` isn't the releaser, or the escrow
    /// isn't currently `Funded` (no double-release, no releasing a
    /// refunded escrow).
    ///
    /// Deliberately **not** gated by `refund_after` (docs/adr/0004): after
    /// the deadline the releaser can still release, racing any timeout
    /// refund — whoever lands first wins and the other fails `NotFunded`.
    ///
    /// If the escrow was created with a `fee` (docs/adr/0005), the fee
    /// comes off the top — `⌊amount × fee.bps ÷ 10 000⌋` goes to
    /// `fee.recipient`, the exact remainder to `payee`, so the two
    /// transfers always sum to the escrowed `amount`. No fee is
    /// ever taken on `refund`, which still returns the full `amount`
    /// to the payer.
    pub fn release(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let mut data: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::NotFound)?;

        if caller != data.releaser {
            return Err(Error::Unauthorized);
        }
        if data.status != EscrowStatus::Funded {
            return Err(Error::NotFunded);
        }

        let token_client = token::Client::new(&env, &data.token);

        // Fee off the top (docs/adr/0005, decision 4): one transfer to
        // the recipient, then the remainder to the payee — the two
        // always sum to exactly the stored `amount` (invariant I6).
        // Rounding floors, so the fee can never exceed its bps share.
        // Both fields were validated together at creation, so the
        // fallback arm cannot occur for an existing escrow.
        let fee = match (&data.fee_recipient, &data.fee_bps) {
            (Some(recipient), Some(bps)) => {
                let fee = Self::fee_amount(data.amount, *bps)?;
                if fee > 0 {
                    token_client.transfer(&env.current_contract_address(), recipient, &fee);
                }
                fee
            }
            _ => 0,
        };
        token_client.transfer(&env.current_contract_address(), &data.payee, &(data.amount - fee));

        data.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &data);
        Ok(())
    }

    /// Returns the escrowed `amount` to `payer`. Same state rule as
    /// `release` (only while `Funded`), but two callers are authorised:
    ///
    /// - the escrow's `releaser` (docs/adr/0002), always; or
    /// - **anyone**, once `refund_after` has been reached — the timeout
    ///   refund path for a lost/unsignable `releaser` key (docs/adr/0004).
    ///
    /// The destination never changes: timeout or not, funds only ever go
    /// back to the stored `payer`. With no `refund_after` set, behaviour
    /// is identical to before the timeout existed — releaser only.
    /// A protocol fee (docs/adr/0005) is never taken on the refund path:
    /// the payer receives the full stored `amount`.
    pub fn refund(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let mut data: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::NotFound)?;

        let timeout_passed = match data.refund_after {
            Some(deadline) => env.ledger().timestamp() >= deadline,
            None => false,
        };
        if caller != data.releaser && !timeout_passed {
            return Err(Error::Unauthorized);
        }
        if data.status != EscrowStatus::Funded {
            return Err(Error::NotFunded);
        }

        let token_client = token::Client::new(&env, &data.token);
        token_client.transfer(&env.current_contract_address(), &data.payer, &data.amount);

        data.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &data);
        Ok(())
    }

    /// The protocol fee taken off the top at release: the escrowed
    /// `amount` scaled by `bps` (of 10 000), rounded **down** so the
    /// fee is never more than its share and fee + payee remainder always
    /// equals the released `amount` (docs/adr/0005, decisions 3 and 4).
    /// Overflow of the scaled multiplication is rejected as
    /// `InvalidFee` — checked at creation (before funds are locked) and
    /// again defensively at release, where it can no longer occur.
    fn fee_amount(amount: i128, bps: u32) -> Result<i128, Error> {
        amount
            .checked_mul(i128::from(bps))
            .and_then(|scaled| scaled.checked_div(BASIS_POINTS))
            .ok_or(Error::InvalidFee)
    }

    fn next_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        id
    }
}
