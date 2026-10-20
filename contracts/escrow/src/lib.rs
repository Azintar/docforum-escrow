// Soroban escrow contract.
//
// Phase E1 (see ROADMAP.md): create_escrow, get_status.
// Phase E2: release, refund. Both restricted to the escrow's `releaser`
// address, set at create_escrow time — see docs/adr/0002 for why a
// per-escrow releaser was chosen over a single contract-level admin.
// Phase E4 (issue #11): optional `refund_after` timeout refund — see
// docs/adr/0004. After that deadline anyone may refund, but only back to
// the payer, so a lost `releaser` key can no longer lock funds forever.
// Phase E5 (issue #35): a narrow emergency pause — see docs/adr/0005. One
// address set by `__constructor` may flip a flag that blocks NEW deposits
// (`create_escrow`) only. `release`, `refund` and the timeout refund never
// read it: a pause can stop new exposure, never lock existing funds.
//
// Hard rule (see ARCHITECTURE_ESSENTIALS.md / docs/adr/0001): the contract
// enforces WHO may act, not WHY. `condition_ref` is opaque — the contract
// never interprets it. Keep it that way; domain logic belongs in the
// consuming application (docforum-core), never here.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, String,
};

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
}

#[contracttype]
enum DataKey {
    Escrow(u64),
    NextId,
    /// The one address allowed to `pause`/`unpause` — set once by
    /// `__constructor`, never changeable afterwards (docs/adr/0005).
    PauseAdmin,
    /// The emergency-pause flag. Absent/false = normal operation; only
    /// `create_escrow` reads it (docs/adr/0005).
    Paused,
}

/// Emitted by `pause` (docs/adr/0005). Carries the custodian that flipped
/// the flag so integrators and monitoring can react without polling.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paused {
    #[topic]
    pub admin: Address,
}

/// Emitted by `unpause` (docs/adr/0005).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unpaused {
    #[topic]
    pub admin: Address,
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
    /// New deposits are blocked: the contract is paused (docs/adr/0005).
    /// Only `create_escrow` ever returns this — every outbound path
    /// (`release`, `refund`, timeout refund) is unaffected by the pause.
    Paused = 7,
    /// `pause` called while the contract is already paused — a no-op is
    /// rejected rather than emitting an event for a transition that
    /// didn't happen (docs/adr/0005).
    AlreadyPaused = 8,
    /// `unpause` called while the contract is not paused (docs/adr/0005).
    NotPaused = 9,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deploy-time configuration (docs/adr/0005): stores the single
    /// address permitted to `pause`/`unpause`. There is no setter, so the
    /// custodian cannot be changed after deployment — a new custodian means
    /// a new deployment. No auth is required here: the constructor runs as
    /// part of deploying the instance, before any caller exists.
    ///
    /// The custodian is deliberately weak: its only power is to refuse
    /// **new** escrows. It cannot release, refund, edit an escrow, or
    /// upgrade anything.
    pub fn __constructor(env: Env, pause_admin: Address) {
        env.storage().instance().set(&DataKey::PauseAdmin, &pause_admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }
}

#[contractimpl]
impl EscrowContract {
    /// Locks `amount` of `token` pulled from `payer`, held for `payee`,
    /// tagged with an opaque `condition_ref`. `releaser` is the only
    /// address that will later be permitted to call `release`/`refund`
    /// on this escrow (see docs/adr/0002). `refund_after` is an optional
    /// unix timestamp after which `refund` opens to any caller, always
    /// back to `payer` (docs/adr/0004); `None` means no timeout.
    /// Requires `payer` auth (the contract moves their funds). Returns
    /// the new escrow's id.
    ///
    /// This is the contract's only deposit path, and the only function the
    /// emergency pause gates (docs/adr/0005): while paused it fails with
    /// `Paused` before any funds move, no escrow id is consumed and nothing
    /// is stored. Any future deposit path must apply the same check.
    pub fn create_escrow(
        env: Env,
        payer: Address,
        payee: Address,
        token: Address,
        amount: i128,
        condition_ref: String,
        releaser: Address,
        refund_after: Option<u64>,
    ) -> Result<u64, Error> {
        if Self::is_paused(env.clone()) {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if let Some(deadline) = refund_after {
            if deadline <= env.ledger().timestamp() {
                return Err(Error::InvalidRefundAfter);
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
    /// payer, payee, token, amount, `condition_ref`, status, `releaser`
    /// and `refund_after`. Exists so payees and integrators can check
    /// the deadline before relying on a `Funded` escrow (docs/adr/0004,
    /// threat model T8). Errors on an unknown id.
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
    /// Also deliberately **not** gated by the emergency pause
    /// (docs/adr/0005): funds must always be able to leave an existing
    /// escrow, whatever state new deposits are in.
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
        token_client.transfer(&env.current_contract_address(), &data.payee, &data.amount);

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
    ///
    /// Deliberately **not** gated by the emergency pause (docs/adr/0005):
    /// pausing new deposits must never trap funds already escrowed.
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

    /// Blocks new deposits (`create_escrow`) until `unpause` is called.
    /// Callable only by the custodian set at deployment, which must sign
    /// this call (docs/adr/0005). Emits a `Paused` event carrying that
    /// address.
    ///
    /// Deliberately has no effect on money already escrowed: `release`,
    /// `refund` and the timeout refund do not read the flag, so a pause can
    /// never lock existing funds. Errors `AlreadyPaused` if the contract is
    /// already paused.
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_pause_admin(&env, &caller)?;
        if Self::is_paused(env.clone()) {
            return Err(Error::AlreadyPaused);
        }

        env.storage().instance().set(&DataKey::Paused, &true);
        Paused { admin: caller }.publish(&env);
        Ok(())
    }

    /// Re-opens new deposits. Same auth as `pause` — only the custodian
    /// set at deployment. Emits an `Unpaused` event. Errors `NotPaused` if
    /// the contract isn't paused.
    ///
    /// Unpausing is not timelocked on purpose (docs/adr/0005): it restores
    /// normal operation and cannot touch a single escrow, so delaying it
    /// would only delay recovery.
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_pause_admin(&env, &caller)?;
        if !Self::is_paused(env.clone()) {
            return Err(Error::NotPaused);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        Unpaused { admin: caller }.publish(&env);
        Ok(())
    }

    /// Read-only: is the emergency pause currently blocking new deposits?
    /// Says nothing about existing escrows — `release`/`refund` work either
    /// way (docs/adr/0005).
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    /// Read-only: the custodian address that may `pause`/`unpause`, so
    /// integrators can verify who holds the role without trusting docs
    /// (docs/adr/0005). `None` only for an instance deployed without a
    /// constructor, which this contract's WASM does not allow.
    pub fn get_pause_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PauseAdmin)
    }

    fn require_pause_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Option<Address> = env.storage().instance().get(&DataKey::PauseAdmin);
        match admin {
            Some(admin) if &admin == caller => Ok(()),
            _ => Err(Error::Unauthorized),
        }
    }

    fn next_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        id
    }
}
