import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"NotFound"},
  2: {message:"InvalidAmount"},
  3: {message:"Unauthorized"},
  4: {message:"NotFunded"},
  /**
   * `refund_after` was not strictly in the future at creation — see
   * docs/adr/0004: a deadline that has already passed would let
   * anyone refund the escrow before the releaser could ever act.
   */
  5: {message:"InvalidRefundAfter"},
  /**
   * The contract's token balance didn't rise by exactly `amount`
   * across `create_escrow`'s transfer (a lying or short-delivering
   * token) — see docs/threat-model.md T5.
   */
  6: {message:"BalanceMismatch"},
  /**
   * The optional fee was misconfigured at creation: `bps` above
   * [`MAX_FEE_BPS`] (10 %), a recipient equal to the escrow contract
   * itself, or an amount that would overflow the fee math — see
   * docs/adr/0005 (decisions 2, 3 and 5).
   */
  7: {message:"InvalidFee"}
}


export interface EscrowData {
  amount: i128;
  condition_ref: string;
  /**
 * Fee rate in basis points of `amount` (capped at [`MAX_FEE_BPS`]
 * = 10 %), taken once at release, rounded **down** with the
 * remainder to the payee — see docs/adr/0005 (decisions 2 and 3).
 */
fee_bps: Option<u32>;
  /**
 * Optional protocol fee, set once at `create_escrow` time and taken
 * at release (never on refund) — see docs/adr/0005. Stored as one
 * (recipient, bps) pair in two fields so both are always set together
 * or not at all (creation-time rule, `InvalidFee` otherwise); a
 * partially-set pair can never be read back from an escrow that
 * exists. `None` bps (with no recipient) means no fee: the payee
 * receives the full `amount`, exactly as before this existed.
 */
fee_recipient: Option<string>;
  payee: string;
  payer: string;
  /**
 * Optional deadline (unix seconds) after which `refund` opens to
 * anyone — still only back to `payer`. `None` means no timeout,
 * behaviour identical to before this field existed — see docs/adr/0004.
 */
refund_after: Option<u64>;
  /**
 * The only address permitted to call `release`/`refund` on this
 * escrow. Set once at `create_escrow` time — see docs/adr/0002.
 */
releaser: string;
  status: EscrowStatus;
  token: string;
}

export type EscrowStatus = {tag: "Funded", values: void} | {tag: "Released", values: void} | {tag: "Refunded", values: void};

export interface Client {
  /**
   * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the escrowed `amount` to `payer`. Same state rule as
   * `release` (only while `Funded`), but two callers are authorised:
   * 
   * - the escrow's `releaser` (docs/adr/0002), always; or
   * - **anyone**, once `refund_after` has been reached — the timeout
   * refund path for a lost/unsignable `releaser` key (docs/adr/0004).
   * 
   * The destination never changes: timeout or not, funds only ever go
   * back to the stored `payer`. With no `refund_after` set, behaviour
   * is identical to before the timeout existed — releaser only.
   * A protocol fee (docs/adr/0005) is never taken on the refund path:
   * the payer receives the full stored `amount`.
   */
  refund: ({escrow_id, caller}: {escrow_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a release transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Moves the escrowed `amount` to `payee`. Only the escrow's
   * `releaser` (set at `create_escrow` time) may call this — the
   * contract enforces WHO, never WHY (ADR 0001). Errors if the
   * escrow doesn't exist, `caller` isn't the releaser, or the escrow
   * isn't currently `Funded` (no double-release, no releasing a
   * refunded escrow).
   * 
   * Deliberately **not** gated by `refund_after` (docs/adr/0004): after
   * the deadline the releaser can still release, racing any timeout
   * refund — whoever lands first wins and the other fails `NotFunded`.
   * 
   * If the escrow was created with a `fee` (docs/adr/0005), the fee
   * comes off the top — `⌊amount × fee.bps ÷ 10 000⌋` goes to
   * `fee.recipient`, the exact remainder to `payee`, so the two
   * transfers always sum to the escrowed `amount`. No fee is
   * ever taken on `refund`, which still returns the full `amount`
   * to the payer.
   */
  release: ({escrow_id, caller}: {escrow_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only accessor for everything stored about `escrow_id` —
   * payer, payee, token, amount, `condition_ref`, status, `releaser`,
   * `refund_after` and the optional fee (`fee_recipient`/`fee_bps`,
   * exactly as declared at creation). Exists so payees and integrators
   * can check the deadline — and both parties the exact fee — before
   * relying on a `Funded` escrow (docs/adr/0004, threat model T8;
   * docs/adr/0005). Errors on an unknown id.
   */
  get_escrow: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<EscrowData>>>

  /**
   * Construct and simulate a get_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only status query. Errors if `escrow_id` doesn't exist.
   */
  get_status: ({escrow_id}: {escrow_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<EscrowStatus>>>

  /**
   * Construct and simulate a create_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Locks `amount` of `token` pulled from `payer`, held for `payee`,
   * tagged with an opaque `condition_ref`. `releaser` is the only
   * address that will later be permitted to call `release`/`refund`
   * on this escrow (see docs/adr/0002). `refund_after` is an optional
   * unix timestamp after which `refund` opens to any caller, always
   * back to `payer` (docs/adr/0004); `None` means no timeout.
   * `fee_recipient`/`fee_bps` are the optional protocol fee, fixed
   * at creation and taken at release — never on refund — to a
   * recipient other than the contract itself, with `fee_bps ≤`
   * [`MAX_FEE_BPS`] (10 %) and floor rounding; both are given
   * together or not at all (docs/adr/0005). `None` on both means no
   * fee.
   * Requires `payer` auth (the contract moves their funds). Returns
   * the new escrow's id.
   */
  create_escrow: ({payer, payee, token, amount, condition_ref, releaser, refund_after, fee_recipient, fee_bps}: {payer: string, payee: string, token: string, amount: i128, condition_ref: string, releaser: string, refund_after: Option<u64>, fee_recipient: Option<string>, fee_bps: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABwAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAAAAAAAJTm90RnVuZGVkAAAAAAAABAAAALpgcmVmdW5kX2FmdGVyYCB3YXMgbm90IHN0cmljdGx5IGluIHRoZSBmdXR1cmUgYXQgY3JlYXRpb24g4oCUIHNlZQpkb2NzL2Fkci8wMDA0OiBhIGRlYWRsaW5lIHRoYXQgaGFzIGFscmVhZHkgcGFzc2VkIHdvdWxkIGxldAphbnlvbmUgcmVmdW5kIHRoZSBlc2Nyb3cgYmVmb3JlIHRoZSByZWxlYXNlciBjb3VsZCBldmVyIGFjdC4AAAAAABJJbnZhbGlkUmVmdW5kQWZ0ZXIAAAAAAAUAAACjVGhlIGNvbnRyYWN0J3MgdG9rZW4gYmFsYW5jZSBkaWRuJ3QgcmlzZSBieSBleGFjdGx5IGBhbW91bnRgCmFjcm9zcyBgY3JlYXRlX2VzY3Jvd2AncyB0cmFuc2ZlciAoYSBseWluZyBvciBzaG9ydC1kZWxpdmVyaW5nCnRva2VuKSDigJQgc2VlIGRvY3MvdGhyZWF0LW1vZGVsLm1kIFQ1LgAAAAAPQmFsYW5jZU1pc21hdGNoAAAAAAYAAADgVGhlIG9wdGlvbmFsIGZlZSB3YXMgbWlzY29uZmlndXJlZCBhdCBjcmVhdGlvbjogYGJwc2AgYWJvdmUKW2BNQVhfRkVFX0JQU2BdICgxMCAlKSwgYSByZWNpcGllbnQgZXF1YWwgdG8gdGhlIGVzY3JvdyBjb250cmFjdAppdHNlbGYsIG9yIGFuIGFtb3VudCB0aGF0IHdvdWxkIG92ZXJmbG93IHRoZSBmZWUgbWF0aCDigJQgc2VlCmRvY3MvYWRyLzAwMDUgKGRlY2lzaW9ucyAyLCAzIGFuZCA1KS4AAAAKSW52YWxpZEZlZQAAAAAABw==",
        "AAAAAQAAAAAAAAAAAAAACkVzY3Jvd0RhdGEAAAAAAAoAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAANY29uZGl0aW9uX3JlZgAAAAAAABAAAAC7RmVlIHJhdGUgaW4gYmFzaXMgcG9pbnRzIG9mIGBhbW91bnRgIChjYXBwZWQgYXQgW2BNQVhfRkVFX0JQU2BdCj0gMTAgJSksIHRha2VuIG9uY2UgYXQgcmVsZWFzZSwgcm91bmRlZCAqKmRvd24qKiB3aXRoIHRoZQpyZW1haW5kZXIgdG8gdGhlIHBheWVlIOKAlCBzZWUgZG9jcy9hZHIvMDAwNSAoZGVjaXNpb25zIDIgYW5kIDMpLgAAAAAHZmVlX2JwcwAAAAPoAAAABAAAAb5PcHRpb25hbCBwcm90b2NvbCBmZWUsIHNldCBvbmNlIGF0IGBjcmVhdGVfZXNjcm93YCB0aW1lIGFuZCB0YWtlbgphdCByZWxlYXNlIChuZXZlciBvbiByZWZ1bmQpIOKAlCBzZWUgZG9jcy9hZHIvMDAwNS4gU3RvcmVkIGFzIG9uZQoocmVjaXBpZW50LCBicHMpIHBhaXIgaW4gdHdvIGZpZWxkcyBzbyBib3RoIGFyZSBhbHdheXMgc2V0IHRvZ2V0aGVyCm9yIG5vdCBhdCBhbGwgKGNyZWF0aW9uLXRpbWUgcnVsZSwgYEludmFsaWRGZWVgIG90aGVyd2lzZSk7IGEKcGFydGlhbGx5LXNldCBwYWlyIGNhbiBuZXZlciBiZSByZWFkIGJhY2sgZnJvbSBhbiBlc2Nyb3cgdGhhdApleGlzdHMuIGBOb25lYCBicHMgKHdpdGggbm8gcmVjaXBpZW50KSBtZWFucyBubyBmZWU6IHRoZSBwYXllZQpyZWNlaXZlcyB0aGUgZnVsbCBgYW1vdW50YCwgZXhhY3RseSBhcyBiZWZvcmUgdGhpcyBleGlzdGVkLgAAAAAADWZlZV9yZWNpcGllbnQAAAAAAAPoAAAAEwAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAAAAAAVwYXllcgAAAAAAABMAAADGT3B0aW9uYWwgZGVhZGxpbmUgKHVuaXggc2Vjb25kcykgYWZ0ZXIgd2hpY2ggYHJlZnVuZGAgb3BlbnMgdG8KYW55b25lIOKAlCBzdGlsbCBvbmx5IGJhY2sgdG8gYHBheWVyYC4gYE5vbmVgIG1lYW5zIG5vIHRpbWVvdXQsCmJlaGF2aW91ciBpZGVudGljYWwgdG8gYmVmb3JlIHRoaXMgZmllbGQgZXhpc3RlZCDigJQgc2VlIGRvY3MvYWRyLzAwMDQuAAAAAAAMcmVmdW5kX2FmdGVyAAAD6AAAAAYAAAB9VGhlIG9ubHkgYWRkcmVzcyBwZXJtaXR0ZWQgdG8gY2FsbCBgcmVsZWFzZWAvYHJlZnVuZGAgb24gdGhpcwplc2Nyb3cuIFNldCBvbmNlIGF0IGBjcmVhdGVfZXNjcm93YCB0aW1lIOKAlCBzZWUgZG9jcy9hZHIvMDAwMi4AAAAAAAAIcmVsZWFzZXIAAAATAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAMRXNjcm93U3RhdHVzAAAAAAAAAAV0b2tlbgAAAAAAABM=",
        "AAAAAgAAAAAAAAAAAAAADEVzY3Jvd1N0YXR1cwAAAAMAAAAAAAAAAAAAAAZGdW5kZWQAAAAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAAAAAAAAAAAIUmVmdW5kZWQ=",
        "AAAAAAAAAmtSZXR1cm5zIHRoZSBlc2Nyb3dlZCBgYW1vdW50YCB0byBgcGF5ZXJgLiBTYW1lIHN0YXRlIHJ1bGUgYXMKYHJlbGVhc2VgIChvbmx5IHdoaWxlIGBGdW5kZWRgKSwgYnV0IHR3byBjYWxsZXJzIGFyZSBhdXRob3Jpc2VkOgoKLSB0aGUgZXNjcm93J3MgYHJlbGVhc2VyYCAoZG9jcy9hZHIvMDAwMiksIGFsd2F5czsgb3IKLSAqKmFueW9uZSoqLCBvbmNlIGByZWZ1bmRfYWZ0ZXJgIGhhcyBiZWVuIHJlYWNoZWQg4oCUIHRoZSB0aW1lb3V0CnJlZnVuZCBwYXRoIGZvciBhIGxvc3QvdW5zaWduYWJsZSBgcmVsZWFzZXJgIGtleSAoZG9jcy9hZHIvMDAwNCkuCgpUaGUgZGVzdGluYXRpb24gbmV2ZXIgY2hhbmdlczogdGltZW91dCBvciBub3QsIGZ1bmRzIG9ubHkgZXZlciBnbwpiYWNrIHRvIHRoZSBzdG9yZWQgYHBheWVyYC4gV2l0aCBubyBgcmVmdW5kX2FmdGVyYCBzZXQsIGJlaGF2aW91cgppcyBpZGVudGljYWwgdG8gYmVmb3JlIHRoZSB0aW1lb3V0IGV4aXN0ZWQg4oCUIHJlbGVhc2VyIG9ubHkuCkEgcHJvdG9jb2wgZmVlIChkb2NzL2Fkci8wMDA1KSBpcyBuZXZlciB0YWtlbiBvbiB0aGUgcmVmdW5kIHBhdGg6CnRoZSBwYXllciByZWNlaXZlcyB0aGUgZnVsbCBzdG9yZWQgYGFtb3VudGAuAAAAAAZyZWZ1bmQAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAA1BNb3ZlcyB0aGUgZXNjcm93ZWQgYGFtb3VudGAgdG8gYHBheWVlYC4gT25seSB0aGUgZXNjcm93J3MKYHJlbGVhc2VyYCAoc2V0IGF0IGBjcmVhdGVfZXNjcm93YCB0aW1lKSBtYXkgY2FsbCB0aGlzIOKAlCB0aGUKY29udHJhY3QgZW5mb3JjZXMgV0hPLCBuZXZlciBXSFkgKEFEUiAwMDAxKS4gRXJyb3JzIGlmIHRoZQplc2Nyb3cgZG9lc24ndCBleGlzdCwgYGNhbGxlcmAgaXNuJ3QgdGhlIHJlbGVhc2VyLCBvciB0aGUgZXNjcm93Cmlzbid0IGN1cnJlbnRseSBgRnVuZGVkYCAobm8gZG91YmxlLXJlbGVhc2UsIG5vIHJlbGVhc2luZyBhCnJlZnVuZGVkIGVzY3JvdykuCgpEZWxpYmVyYXRlbHkgKipub3QqKiBnYXRlZCBieSBgcmVmdW5kX2FmdGVyYCAoZG9jcy9hZHIvMDAwNCk6IGFmdGVyCnRoZSBkZWFkbGluZSB0aGUgcmVsZWFzZXIgY2FuIHN0aWxsIHJlbGVhc2UsIHJhY2luZyBhbnkgdGltZW91dApyZWZ1bmQg4oCUIHdob2V2ZXIgbGFuZHMgZmlyc3Qgd2lucyBhbmQgdGhlIG90aGVyIGZhaWxzIGBOb3RGdW5kZWRgLgoKSWYgdGhlIGVzY3JvdyB3YXMgY3JlYXRlZCB3aXRoIGEgYGZlZWAgKGRvY3MvYWRyLzAwMDUpLCB0aGUgZmVlCmNvbWVzIG9mZiB0aGUgdG9wIOKAlCBg4oyKYW1vdW50IMOXIGZlZS5icHMgw7cgMTAgMDAw4oyLYCBnb2VzIHRvCmBmZWUucmVjaXBpZW50YCwgdGhlIGV4YWN0IHJlbWFpbmRlciB0byBgcGF5ZWVgLCBzbyB0aGUgdHdvCnRyYW5zZmVycyBhbHdheXMgc3VtIHRvIHRoZSBlc2Nyb3dlZCBgYW1vdW50YC4gTm8gZmVlIGlzCmV2ZXIgdGFrZW4gb24gYHJlZnVuZGAsIHdoaWNoIHN0aWxsIHJldHVybnMgdGhlIGZ1bGwgYGFtb3VudGAKdG8gdGhlIHBheWVyLgAAAAdyZWxlYXNlAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAa9SZWFkLW9ubHkgYWNjZXNzb3IgZm9yIGV2ZXJ5dGhpbmcgc3RvcmVkIGFib3V0IGBlc2Nyb3dfaWRgIOKAlApwYXllciwgcGF5ZWUsIHRva2VuLCBhbW91bnQsIGBjb25kaXRpb25fcmVmYCwgc3RhdHVzLCBgcmVsZWFzZXJgLApgcmVmdW5kX2FmdGVyYCBhbmQgdGhlIG9wdGlvbmFsIGZlZSAoYGZlZV9yZWNpcGllbnRgL2BmZWVfYnBzYCwKZXhhY3RseSBhcyBkZWNsYXJlZCBhdCBjcmVhdGlvbikuIEV4aXN0cyBzbyBwYXllZXMgYW5kIGludGVncmF0b3JzCmNhbiBjaGVjayB0aGUgZGVhZGxpbmUg4oCUIGFuZCBib3RoIHBhcnRpZXMgdGhlIGV4YWN0IGZlZSDigJQgYmVmb3JlCnJlbHlpbmcgb24gYSBgRnVuZGVkYCBlc2Nyb3cgKGRvY3MvYWRyLzAwMDQsIHRocmVhdCBtb2RlbCBUODsKZG9jcy9hZHIvMDAwNSkuIEVycm9ycyBvbiBhbiB1bmtub3duIGlkLgAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAApFc2Nyb3dEYXRhAAAAAAAD",
        "AAAAAAAAADxSZWFkLW9ubHkgc3RhdHVzIHF1ZXJ5LiBFcnJvcnMgaWYgYGVzY3Jvd19pZGAgZG9lc24ndCBleGlzdC4AAAAKZ2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAxFc2Nyb3dTdGF0dXMAAAAD",
        "AAAAAAAAAwhMb2NrcyBgYW1vdW50YCBvZiBgdG9rZW5gIHB1bGxlZCBmcm9tIGBwYXllcmAsIGhlbGQgZm9yIGBwYXllZWAsCnRhZ2dlZCB3aXRoIGFuIG9wYXF1ZSBgY29uZGl0aW9uX3JlZmAuIGByZWxlYXNlcmAgaXMgdGhlIG9ubHkKYWRkcmVzcyB0aGF0IHdpbGwgbGF0ZXIgYmUgcGVybWl0dGVkIHRvIGNhbGwgYHJlbGVhc2VgL2ByZWZ1bmRgCm9uIHRoaXMgZXNjcm93IChzZWUgZG9jcy9hZHIvMDAwMikuIGByZWZ1bmRfYWZ0ZXJgIGlzIGFuIG9wdGlvbmFsCnVuaXggdGltZXN0YW1wIGFmdGVyIHdoaWNoIGByZWZ1bmRgIG9wZW5zIHRvIGFueSBjYWxsZXIsIGFsd2F5cwpiYWNrIHRvIGBwYXllcmAgKGRvY3MvYWRyLzAwMDQpOyBgTm9uZWAgbWVhbnMgbm8gdGltZW91dC4KYGZlZV9yZWNpcGllbnRgL2BmZWVfYnBzYCBhcmUgdGhlIG9wdGlvbmFsIHByb3RvY29sIGZlZSwgZml4ZWQKYXQgY3JlYXRpb24gYW5kIHRha2VuIGF0IHJlbGVhc2Ug4oCUIG5ldmVyIG9uIHJlZnVuZCDigJQgdG8gYQpyZWNpcGllbnQgb3RoZXIgdGhhbiB0aGUgY29udHJhY3QgaXRzZWxmLCB3aXRoIGBmZWVfYnBzIOKJpGAKW2BNQVhfRkVFX0JQU2BdICgxMCAlKSBhbmQgZmxvb3Igcm91bmRpbmc7IGJvdGggYXJlIGdpdmVuCnRvZ2V0aGVyIG9yIG5vdCBhdCBhbGwgKGRvY3MvYWRyLzAwMDUpLiBgTm9uZWAgb24gYm90aCBtZWFucyBubwpmZWUuClJlcXVpcmVzIGBwYXllcmAgYXV0aCAodGhlIGNvbnRyYWN0IG1vdmVzIHRoZWlyIGZ1bmRzKS4gUmV0dXJucwp0aGUgbmV3IGVzY3JvdydzIGlkLgAAAA1jcmVhdGVfZXNjcm93AAAAAAAACQAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAVwYXllZQAAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAA1jb25kaXRpb25fcmVmAAAAAAAAEAAAAAAAAAAIcmVsZWFzZXIAAAATAAAAAAAAAAxyZWZ1bmRfYWZ0ZXIAAAPoAAAABgAAAAAAAAANZmVlX3JlY2lwaWVudAAAAAAAA+gAAAATAAAAAAAAAAdmZWVfYnBzAAAAA+gAAAAEAAAAAQAAA+kAAAAGAAAAAw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    refund: this.txFromJSON<Result<void>>,
        release: this.txFromJSON<Result<void>>,
        get_escrow: this.txFromJSON<Result<EscrowData>>,
        get_status: this.txFromJSON<Result<EscrowStatus>>,
        create_escrow: this.txFromJSON<Result<u64>>
  }
}