// GENERATED — do not hand-edit. Produced by:
//   stellar contract bindings typescript \
//     --wasm contracts/escrow/target/wasm32v1-none/release/docforum_escrow.wasm \
//     --output-dir <tmp-dir> --overwrite
// then this one file (src/index.ts in the generator's output) copied here.
// Regenerate whenever contracts/escrow/src/lib.rs's public function
// signatures, types, or doc comments change — the contract spec (and the
// doc comments you see below) come directly from the compiled wasm, not
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
   * New deposits are blocked: the contract is paused (docs/adr/0005).
   * Only `create_escrow` ever returns this — every outbound path
   * (`release`, `refund`, timeout refund) is unaffected by the pause.
   */
  7: {message:"Paused"},
  /**
   * `pause` called while the contract is already paused — a no-op is
   * rejected rather than emitting an event for a transition that
   * didn't happen (docs/adr/0005).
   */
  8: {message:"AlreadyPaused"},
  /**
   * `unpause` called while the contract is not paused (docs/adr/0005).
   */
  9: {message:"NotPaused"}
}




export interface EscrowData {
  amount: i128;
  condition_ref: string;
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
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Blocks new deposits (`create_escrow`) until `unpause` is called.
   * Callable only by the custodian set at deployment, which must sign
   * this call (docs/adr/0005). Emits a `Paused` event carrying that
   * address.
   * 
   * Deliberately has no effect on money already escrowed: `release`,
   * `refund` and the timeout refund do not read the flag, so a pause can
   * never lock existing funds. Errors `AlreadyPaused` if the contract is
   * already paused.
   */
  pause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * 
   * Deliberately **not** gated by the emergency pause (docs/adr/0005):
   * pausing new deposits must never trap funds already escrowed.
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
   * Also deliberately **not** gated by the emergency pause
   * (docs/adr/0005): funds must always be able to leave an existing
   * escrow, whatever state new deposits are in.
   */
  release: ({escrow_id, caller}: {escrow_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Re-opens new deposits. Same auth as `pause` — only the custodian
   * set at deployment. Emits an `Unpaused` event. Errors `NotPaused` if
   * the contract isn't paused.
   * 
   * Unpausing is not timelocked on purpose (docs/adr/0005): it restores
   * normal operation and cannot touch a single escrow, so delaying it
   * would only delay recovery.
   */
  unpause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only: is the emergency pause currently blocking new deposits?
   * Says nothing about existing escrows — `release`/`refund` work either
   * way (docs/adr/0005).
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only accessor for everything stored about `escrow_id` —
   * payer, payee, token, amount, `condition_ref`, status, `releaser`
   * and `refund_after`. Exists so payees and integrators can check
   * the deadline before relying on a `Funded` escrow (docs/adr/0004,
   * threat model T8). Errors on an unknown id.
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
   * Requires `payer` auth (the contract moves their funds). Returns
   * the new escrow's id.
   * 
   * This is the contract's only deposit path, and the only function the
   * emergency pause gates (docs/adr/0005): while paused it fails with
   * `Paused` before any funds move, no escrow id is consumed and nothing
   * is stored. Any future deposit path must apply the same check.
   */
  create_escrow: ({payer, payee, token, amount, condition_ref, releaser, refund_after}: {payer: string, payee: string, token: string, amount: i128, condition_ref: string, releaser: string, refund_after: Option<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_pause_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only: the custodian address that may `pause`/`unpause`, so
   * integrators can verify who holds the role without trusting docs
   * (docs/adr/0005). `None` only for an instance deployed without a
   * constructor, which this contract's WASM does not allow.
   */
  get_pause_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {pause_admin}: {pause_admin: string},
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
    return ContractClient.deploy({pause_admin}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAAAAAAAJTm90RnVuZGVkAAAAAAAABAAAALpgcmVmdW5kX2FmdGVyYCB3YXMgbm90IHN0cmljdGx5IGluIHRoZSBmdXR1cmUgYXQgY3JlYXRpb24g4oCUIHNlZQpkb2NzL2Fkci8wMDA0OiBhIGRlYWRsaW5lIHRoYXQgaGFzIGFscmVhZHkgcGFzc2VkIHdvdWxkIGxldAphbnlvbmUgcmVmdW5kIHRoZSBlc2Nyb3cgYmVmb3JlIHRoZSByZWxlYXNlciBjb3VsZCBldmVyIGFjdC4AAAAAABJJbnZhbGlkUmVmdW5kQWZ0ZXIAAAAAAAUAAACjVGhlIGNvbnRyYWN0J3MgdG9rZW4gYmFsYW5jZSBkaWRuJ3QgcmlzZSBieSBleGFjdGx5IGBhbW91bnRgCmFjcm9zcyBgY3JlYXRlX2VzY3Jvd2AncyB0cmFuc2ZlciAoYSBseWluZyBvciBzaG9ydC1kZWxpdmVyaW5nCnRva2VuKSDigJQgc2VlIGRvY3MvdGhyZWF0LW1vZGVsLm1kIFQ1LgAAAAAPQmFsYW5jZU1pc21hdGNoAAAAAAYAAADCTmV3IGRlcG9zaXRzIGFyZSBibG9ja2VkOiB0aGUgY29udHJhY3QgaXMgcGF1c2VkIChkb2NzL2Fkci8wMDA1KS4KT25seSBgY3JlYXRlX2VzY3Jvd2AgZXZlciByZXR1cm5zIHRoaXMg4oCUIGV2ZXJ5IG91dGJvdW5kIHBhdGgKKGByZWxlYXNlYCwgYHJlZnVuZGAsIHRpbWVvdXQgcmVmdW5kKSBpcyB1bmFmZmVjdGVkIGJ5IHRoZSBwYXVzZS4AAAAAAAZQYXVzZWQAAAAAAAcAAACeYHBhdXNlYCBjYWxsZWQgd2hpbGUgdGhlIGNvbnRyYWN0IGlzIGFscmVhZHkgcGF1c2VkIOKAlCBhIG5vLW9wIGlzCnJlamVjdGVkIHJhdGhlciB0aGFuIGVtaXR0aW5nIGFuIGV2ZW50IGZvciBhIHRyYW5zaXRpb24gdGhhdApkaWRuJ3QgaGFwcGVuIChkb2NzL2Fkci8wMDA1KS4AAAAAAA1BbHJlYWR5UGF1c2VkAAAAAAAACAAAAEJgdW5wYXVzZWAgY2FsbGVkIHdoaWxlIHRoZSBjb250cmFjdCBpcyBub3QgcGF1c2VkIChkb2NzL2Fkci8wMDA1KS4AAAAAAAlOb3RQYXVzZWQAAAAAAAAJ",
        "AAAABQAAAIhFbWl0dGVkIGJ5IGBwYXVzZWAgKGRvY3MvYWRyLzAwMDUpLiBDYXJyaWVzIHRoZSBjdXN0b2RpYW4gdGhhdCBmbGlwcGVkCnRoZSBmbGFnIHNvIGludGVncmF0b3JzIGFuZCBtb25pdG9yaW5nIGNhbiByZWFjdCB3aXRob3V0IHBvbGxpbmcuAAAAAAAAAAZQYXVzZWQAAAAAAAEAAAAGcGF1c2VkAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAAAg==",
        "AAAABQAAACVFbWl0dGVkIGJ5IGB1bnBhdXNlYCAoZG9jcy9hZHIvMDAwNSkuAAAAAAAAAAAAAAhVbnBhdXNlZAAAAAEAAAAIdW5wYXVzZWQAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAACkVzY3Jvd0RhdGEAAAAAAAgAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAANY29uZGl0aW9uX3JlZgAAAAAAABAAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAxk9wdGlvbmFsIGRlYWRsaW5lICh1bml4IHNlY29uZHMpIGFmdGVyIHdoaWNoIGByZWZ1bmRgIG9wZW5zIHRvCmFueW9uZSDigJQgc3RpbGwgb25seSBiYWNrIHRvIGBwYXllcmAuIGBOb25lYCBtZWFucyBubyB0aW1lb3V0LApiZWhhdmlvdXIgaWRlbnRpY2FsIHRvIGJlZm9yZSB0aGlzIGZpZWxkIGV4aXN0ZWQg4oCUIHNlZSBkb2NzL2Fkci8wMDA0LgAAAAAADHJlZnVuZF9hZnRlcgAAA+gAAAAGAAAAfVRoZSBvbmx5IGFkZHJlc3MgcGVybWl0dGVkIHRvIGNhbGwgYHJlbGVhc2VgL2ByZWZ1bmRgIG9uIHRoaXMKZXNjcm93LiBTZXQgb25jZSBhdCBgY3JlYXRlX2VzY3Jvd2AgdGltZSDigJQgc2VlIGRvY3MvYWRyLzAwMDIuAAAAAAAACHJlbGVhc2VyAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADEVzY3Jvd1N0YXR1cwAAAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAgAAAAAAAAAAAAAADEVzY3Jvd1N0YXR1cwAAAAMAAAAAAAAAAAAAAAZGdW5kZWQAAAAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAAAAAAAAAAAIUmVmdW5kZWQ=",
        "AAAAAAAAAadCbG9ja3MgbmV3IGRlcG9zaXRzIChgY3JlYXRlX2VzY3Jvd2ApIHVudGlsIGB1bnBhdXNlYCBpcyBjYWxsZWQuCkNhbGxhYmxlIG9ubHkgYnkgdGhlIGN1c3RvZGlhbiBzZXQgYXQgZGVwbG95bWVudCwgd2hpY2ggbXVzdCBzaWduCnRoaXMgY2FsbCAoZG9jcy9hZHIvMDAwNSkuIEVtaXRzIGEgYFBhdXNlZGAgZXZlbnQgY2FycnlpbmcgdGhhdAphZGRyZXNzLgoKRGVsaWJlcmF0ZWx5IGhhcyBubyBlZmZlY3Qgb24gbW9uZXkgYWxyZWFkeSBlc2Nyb3dlZDogYHJlbGVhc2VgLApgcmVmdW5kYCBhbmQgdGhlIHRpbWVvdXQgcmVmdW5kIGRvIG5vdCByZWFkIHRoZSBmbGFnLCBzbyBhIHBhdXNlIGNhbgpuZXZlciBsb2NrIGV4aXN0aW5nIGZ1bmRzLiBFcnJvcnMgYEFscmVhZHlQYXVzZWRgIGlmIHRoZSBjb250cmFjdCBpcwphbHJlYWR5IHBhdXNlZC4AAAAABXBhdXNlAAAAAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAn1SZXR1cm5zIHRoZSBlc2Nyb3dlZCBgYW1vdW50YCB0byBgcGF5ZXJgLiBTYW1lIHN0YXRlIHJ1bGUgYXMKYHJlbGVhc2VgIChvbmx5IHdoaWxlIGBGdW5kZWRgKSwgYnV0IHR3byBjYWxsZXJzIGFyZSBhdXRob3Jpc2VkOgoKLSB0aGUgZXNjcm93J3MgYHJlbGVhc2VyYCAoZG9jcy9hZHIvMDAwMiksIGFsd2F5czsgb3IKLSAqKmFueW9uZSoqLCBvbmNlIGByZWZ1bmRfYWZ0ZXJgIGhhcyBiZWVuIHJlYWNoZWQg4oCUIHRoZSB0aW1lb3V0CnJlZnVuZCBwYXRoIGZvciBhIGxvc3QvdW5zaWduYWJsZSBgcmVsZWFzZXJgIGtleSAoZG9jcy9hZHIvMDAwNCkuCgpUaGUgZGVzdGluYXRpb24gbmV2ZXIgY2hhbmdlczogdGltZW91dCBvciBub3QsIGZ1bmRzIG9ubHkgZXZlciBnbwpiYWNrIHRvIHRoZSBzdG9yZWQgYHBheWVyYC4gV2l0aCBubyBgcmVmdW5kX2FmdGVyYCBzZXQsIGJlaGF2aW91cgppcyBpZGVudGljYWwgdG8gYmVmb3JlIHRoZSB0aW1lb3V0IGV4aXN0ZWQg4oCUIHJlbGVhc2VyIG9ubHkuCgpEZWxpYmVyYXRlbHkgKipub3QqKiBnYXRlZCBieSB0aGUgZW1lcmdlbmN5IHBhdXNlIChkb2NzL2Fkci8wMDA1KToKcGF1c2luZyBuZXcgZGVwb3NpdHMgbXVzdCBuZXZlciB0cmFwIGZ1bmRzIGFscmVhZHkgZXNjcm93ZWQuAAAAAAAABnJlZnVuZAAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAArBNb3ZlcyB0aGUgZXNjcm93ZWQgYGFtb3VudGAgdG8gYHBheWVlYC4gT25seSB0aGUgZXNjcm93J3MKYHJlbGVhc2VyYCAoc2V0IGF0IGBjcmVhdGVfZXNjcm93YCB0aW1lKSBtYXkgY2FsbCB0aGlzIOKAlCB0aGUKY29udHJhY3QgZW5mb3JjZXMgV0hPLCBuZXZlciBXSFkgKEFEUiAwMDAxKS4gRXJyb3JzIGlmIHRoZQplc2Nyb3cgZG9lc24ndCBleGlzdCwgYGNhbGxlcmAgaXNuJ3QgdGhlIHJlbGVhc2VyLCBvciB0aGUgZXNjcm93Cmlzbid0IGN1cnJlbnRseSBgRnVuZGVkYCAobm8gZG91YmxlLXJlbGVhc2UsIG5vIHJlbGVhc2luZyBhCnJlZnVuZGVkIGVzY3JvdykuCgpEZWxpYmVyYXRlbHkgKipub3QqKiBnYXRlZCBieSBgcmVmdW5kX2FmdGVyYCAoZG9jcy9hZHIvMDAwNCk6IGFmdGVyCnRoZSBkZWFkbGluZSB0aGUgcmVsZWFzZXIgY2FuIHN0aWxsIHJlbGVhc2UsIHJhY2luZyBhbnkgdGltZW91dApyZWZ1bmQg4oCUIHdob2V2ZXIgbGFuZHMgZmlyc3Qgd2lucyBhbmQgdGhlIG90aGVyIGZhaWxzIGBOb3RGdW5kZWRgLgoKQWxzbyBkZWxpYmVyYXRlbHkgKipub3QqKiBnYXRlZCBieSB0aGUgZW1lcmdlbmN5IHBhdXNlCihkb2NzL2Fkci8wMDA1KTogZnVuZHMgbXVzdCBhbHdheXMgYmUgYWJsZSB0byBsZWF2ZSBhbiBleGlzdGluZwplc2Nyb3csIHdoYXRldmVyIHN0YXRlIG5ldyBkZXBvc2l0cyBhcmUgaW4uAAAAB3JlbGVhc2UAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAUNSZS1vcGVucyBuZXcgZGVwb3NpdHMuIFNhbWUgYXV0aCBhcyBgcGF1c2VgIOKAlCBvbmx5IHRoZSBjdXN0b2RpYW4Kc2V0IGF0IGRlcGxveW1lbnQuIEVtaXRzIGFuIGBVbnBhdXNlZGAgZXZlbnQuIEVycm9ycyBgTm90UGF1c2VkYCBpZgp0aGUgY29udHJhY3QgaXNuJ3QgcGF1c2VkLgoKVW5wYXVzaW5nIGlzIG5vdCB0aW1lbG9ja2VkIG9uIHB1cnBvc2UgKGRvY3MvYWRyLzAwMDUpOiBpdCByZXN0b3Jlcwpub3JtYWwgb3BlcmF0aW9uIGFuZCBjYW5ub3QgdG91Y2ggYSBzaW5nbGUgZXNjcm93LCBzbyBkZWxheWluZyBpdAp3b3VsZCBvbmx5IGRlbGF5IHJlY292ZXJ5LgAAAAAHdW5wYXVzZQAAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAJ5SZWFkLW9ubHk6IGlzIHRoZSBlbWVyZ2VuY3kgcGF1c2UgY3VycmVudGx5IGJsb2NraW5nIG5ldyBkZXBvc2l0cz8KU2F5cyBub3RoaW5nIGFib3V0IGV4aXN0aW5nIGVzY3Jvd3Mg4oCUIGByZWxlYXNlYC9gcmVmdW5kYCB3b3JrIGVpdGhlcgp3YXkgKGRvY3MvYWRyLzAwMDUpLgAAAAAACWlzX3BhdXNlZAAAAAAAAAAAAAABAAAAAQ==",
        "AAAAAAAAASpSZWFkLW9ubHkgYWNjZXNzb3IgZm9yIGV2ZXJ5dGhpbmcgc3RvcmVkIGFib3V0IGBlc2Nyb3dfaWRgIOKAlApwYXllciwgcGF5ZWUsIHRva2VuLCBhbW91bnQsIGBjb25kaXRpb25fcmVmYCwgc3RhdHVzLCBgcmVsZWFzZXJgCmFuZCBgcmVmdW5kX2FmdGVyYC4gRXhpc3RzIHNvIHBheWVlcyBhbmQgaW50ZWdyYXRvcnMgY2FuIGNoZWNrCnRoZSBkZWFkbGluZSBiZWZvcmUgcmVseWluZyBvbiBhIGBGdW5kZWRgIGVzY3JvdyAoZG9jcy9hZHIvMDAwNCwKdGhyZWF0IG1vZGVsIFQ4KS4gRXJyb3JzIG9uIGFuIHVua25vd24gaWQuAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAApFc2Nyb3dEYXRhAAAAAAAD",
        "AAAAAAAAADxSZWFkLW9ubHkgc3RhdHVzIHF1ZXJ5LiBFcnJvcnMgaWYgYGVzY3Jvd19pZGAgZG9lc24ndCBleGlzdC4AAAAKZ2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAxFc2Nyb3dTdGF0dXMAAAAD",
        "AAAAAAAAAdZEZXBsb3ktdGltZSBjb25maWd1cmF0aW9uIChkb2NzL2Fkci8wMDA1KTogc3RvcmVzIHRoZSBzaW5nbGUKYWRkcmVzcyBwZXJtaXR0ZWQgdG8gYHBhdXNlYC9gdW5wYXVzZWAuIFRoZXJlIGlzIG5vIHNldHRlciwgc28gdGhlCmN1c3RvZGlhbiBjYW5ub3QgYmUgY2hhbmdlZCBhZnRlciBkZXBsb3ltZW50IOKAlCBhIG5ldyBjdXN0b2RpYW4gbWVhbnMKYSBuZXcgZGVwbG95bWVudC4gTm8gYXV0aCBpcyByZXF1aXJlZCBoZXJlOiB0aGUgY29uc3RydWN0b3IgcnVucyBhcwpwYXJ0IG9mIGRlcGxveWluZyB0aGUgaW5zdGFuY2UsIGJlZm9yZSBhbnkgY2FsbGVyIGV4aXN0cy4KClRoZSBjdXN0b2RpYW4gaXMgZGVsaWJlcmF0ZWx5IHdlYWs6IGl0cyBvbmx5IHBvd2VyIGlzIHRvIHJlZnVzZQoqKm5ldyoqIGVzY3Jvd3MuIEl0IGNhbm5vdCByZWxlYXNlLCByZWZ1bmQsIGVkaXQgYW4gZXNjcm93LCBvcgp1cGdyYWRlIGFueXRoaW5nLgAAAAAADV9fY29uc3RydWN0b3IAAAAAAAABAAAAAAAAAAtwYXVzZV9hZG1pbgAAAAATAAAAAA==",
        "AAAAAAAAAtlMb2NrcyBgYW1vdW50YCBvZiBgdG9rZW5gIHB1bGxlZCBmcm9tIGBwYXllcmAsIGhlbGQgZm9yIGBwYXllZWAsCnRhZ2dlZCB3aXRoIGFuIG9wYXF1ZSBgY29uZGl0aW9uX3JlZmAuIGByZWxlYXNlcmAgaXMgdGhlIG9ubHkKYWRkcmVzcyB0aGF0IHdpbGwgbGF0ZXIgYmUgcGVybWl0dGVkIHRvIGNhbGwgYHJlbGVhc2VgL2ByZWZ1bmRgCm9uIHRoaXMgZXNjcm93IChzZWUgZG9jcy9hZHIvMDAwMikuIGByZWZ1bmRfYWZ0ZXJgIGlzIGFuIG9wdGlvbmFsCnVuaXggdGltZXN0YW1wIGFmdGVyIHdoaWNoIGByZWZ1bmRgIG9wZW5zIHRvIGFueSBjYWxsZXIsIGFsd2F5cwpiYWNrIHRvIGBwYXllcmAgKGRvY3MvYWRyLzAwMDQpOyBgTm9uZWAgbWVhbnMgbm8gdGltZW91dC4KUmVxdWlyZXMgYHBheWVyYCBhdXRoICh0aGUgY29udHJhY3QgbW92ZXMgdGhlaXIgZnVuZHMpLiBSZXR1cm5zCnRoZSBuZXcgZXNjcm93J3MgaWQuCgpUaGlzIGlzIHRoZSBjb250cmFjdCdzIG9ubHkgZGVwb3NpdCBwYXRoLCBhbmQgdGhlIG9ubHkgZnVuY3Rpb24gdGhlCmVtZXJnZW5jeSBwYXVzZSBnYXRlcyAoZG9jcy9hZHIvMDAwNSk6IHdoaWxlIHBhdXNlZCBpdCBmYWlscyB3aXRoCmBQYXVzZWRgIGJlZm9yZSBhbnkgZnVuZHMgbW92ZSwgbm8gZXNjcm93IGlkIGlzIGNvbnN1bWVkIGFuZCBub3RoaW5nCmlzIHN0b3JlZC4gQW55IGZ1dHVyZSBkZXBvc2l0IHBhdGggbXVzdCBhcHBseSB0aGUgc2FtZSBjaGVjay4AAAAAAAANY3JlYXRlX2VzY3JvdwAAAAAAAAcAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAANY29uZGl0aW9uX3JlZgAAAAAAABAAAAAAAAAACHJlbGVhc2VyAAAAEwAAAAAAAAAMcmVmdW5kX2FmdGVyAAAD6AAAAAYAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAPdSZWFkLW9ubHk6IHRoZSBjdXN0b2RpYW4gYWRkcmVzcyB0aGF0IG1heSBgcGF1c2VgL2B1bnBhdXNlYCwgc28KaW50ZWdyYXRvcnMgY2FuIHZlcmlmeSB3aG8gaG9sZHMgdGhlIHJvbGUgd2l0aG91dCB0cnVzdGluZyBkb2NzCihkb2NzL2Fkci8wMDA1KS4gYE5vbmVgIG9ubHkgZm9yIGFuIGluc3RhbmNlIGRlcGxveWVkIHdpdGhvdXQgYQpjb25zdHJ1Y3Rvciwgd2hpY2ggdGhpcyBjb250cmFjdCdzIFdBU00gZG9lcyBub3QgYWxsb3cuAAAAAA9nZXRfcGF1c2VfYWRtaW4AAAAAAAAAAAEAAAPoAAAAEw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    pause: this.txFromJSON<Result<void>>,
        refund: this.txFromJSON<Result<void>>,
        release: this.txFromJSON<Result<void>>,
        unpause: this.txFromJSON<Result<void>>,
        is_paused: this.txFromJSON<boolean>,
        get_escrow: this.txFromJSON<Result<EscrowData>>,
        get_status: this.txFromJSON<Result<EscrowStatus>>,
        create_escrow: this.txFromJSON<Result<u64>>,
        get_pause_admin: this.txFromJSON<Option<string>>
  }
}