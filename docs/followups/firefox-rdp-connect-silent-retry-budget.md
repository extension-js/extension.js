# Follow-up: Firefox RDP connect retries are silent for ~150s

**Status:** open · **Severity:** low (observability / DX; no incorrect behavior on its own) · **Area:** Firefox launch RDP connect (`RemoteFirefox.connectClient`)
**Owner:** unassigned · **Created:** 2026-06-29 · **Repo:** `extension.js`

This is a self-contained handoff. You should not need the originating conversation.

---

## TL;DR

When `RemoteFirefox` cannot reach Firefox's RDP debugger server, `connectClient`
retries on `ECONNREFUSED` **silently** — no log line per attempt — for
`RDP_MAX_RETRIES (150) × RDP_RETRY_INTERVAL_MS (1000)` ≈ **150 seconds** before it
finally throws. To anyone watching, a `dev --browser=firefox` run just *hangs* with
no indication of what it is waiting for. This is purely an observability gap: the
retry itself is correct (Firefox's RDP server can take a moment to come up), but
its silence makes any connect-side failure (wrong port, firewalled port, Firefox
crashed at startup) look identical to a generic stall.

This footgun is what masked the port-derivation bug fixed in
[`firefox-launcher-at-launch-injection-race.md`](./firefox-launcher-at-launch-injection-race.md)
for as long as it did: the installer was hammering a dead port (9330 instead of
9230), but every attempt was silent, so the only visible symptom was a 150s
timeout with no clue.

## Where

`programs/extension/browsers/run-firefox/firefox-source-inspection/remote-firefox/index.ts`
— `connectClient(port)`:

```ts
for (const _ of Array.from({length: MAX_RETRIES})) {   // MAX_RETRIES = 150
  try { /* connect */ return client }
  catch (error) {
    if (isErrorWithCode('ECONNREFUSED', error)) {
      await sleep(RETRY_INTERVAL)                        // 1000ms, NO log
      lastError = error
    } else { /* non-ECONNREFUSED IS logged + thrown */ }
  }
}
console.error(messages.errorConnectingToBrowser(...))   // only after ~150s
```

Constants: `programs/extension/browsers/browsers-lib/constants.ts`
(`RDP_MAX_RETRIES`, `RDP_RETRY_INTERVAL_MS`; both env-overridable via
`EXTENSION_RDP_MAX_RETRIES` / `EXTENSION_RDP_RETRY_INTERVAL_MS`).

## Suggested fix (pick one or combine)

1. **Periodic progress log.** In author mode (or always), emit one line every N
   attempts: `"[browser] Waiting for Firefox RDP on <port> (attempt k/150)…"`,
   ideally naming the port. Cheap, and would have made the port bug obvious.
2. **Lower the default budget.** 150s is very long for a localhost connect. A
   ~20–30s budget (e.g. 60 × 500ms) fails fast and surfaces the real error sooner;
   keep the env override for slow CI.
3. **Name the port in the terminal error.** `errorConnectingToBrowser` should
   include the port it gave up on, so a wrong-port mismatch is self-evident.

Recommended: (1) + (3) at minimum; (2) is a judgment call on CI tolerance.

## Validation

Reproduce the silence by pointing the installer at a closed port (e.g. temporarily
break `resolveRdpPort`, or set `EXTENSION_RDP_MAX_RETRIES=4
EXTENSION_RDP_RETRY_INTERVAL_MS=300` to compress the window): you'll see the run
sit idle, then — only with a small budget — the `RDP setup retry k/5` lines from
`setup-rdp-after-launch.ts`'s *outer* retry (which IS logged in author mode). The
*inner* `connectClient` ECONNREFUSED loop has no such logging; that's the gap.

## History

- Surfaced 2026-06-29 while root-causing the launched-Firefox add-on install
  failure (the port double-derivation). The fix there made the connect succeed;
  this note tracks the orthogonal observability gap that hid it.
