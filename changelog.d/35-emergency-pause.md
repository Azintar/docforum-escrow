Issue #35 (Phase E5): deposit-only emergency pause. The contract's
`__constructor` now also takes a `pause_admin` address; only that custodian
can call `pause`/`unpause`, and while paused every deposit path fails with
`Paused` before any funds move (26/27/28 are the new append-only error
codes). `release`, `refund` and the timeout refund never read the flag, so a
pause can stop new exposure but never lock escrowed funds (invariant I7,
threat model T12, `docs/adr/0011`). The SDK gains `pause`/`unpause`/
`isPaused`/`getPauseAdmin` (minor changeset) and regenerated bindings. This
is a deployment change: the live testnet contract predates the constructor
and cannot pause until it is redeployed.
