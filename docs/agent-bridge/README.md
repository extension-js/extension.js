# Agent Bridge — contracts

Machine-readable contracts for the dev-time observability + control plane that
lets an LLM (or a human, or any file-reading tool) observe and act on an
Extension.js dev build running in the browser. See **[`SURFACE.md`](./SURFACE.md)**
for the full design: the two local injection points, the hosted preview backend,
the three consumption tiers, the surface map, auth, and the build order.

## Files

| File | What it defines |
|---|---|
| `log-event.schema.json` (v1.0) | one log line — wire, `logs.ndjson`, and sidebar share this exact shape |
| `control-envelope.schema.json` (v1.0) | every frame on the dedicated control WebSocket (`hello`/`ready`/`log`/`gap`/`command`/`result`) |
| `ready-contract.schema.json` (v2.0) | `dist/extension-js/<browser>/ready.json` — the per-session runtime contract + control-channel discovery |
| `actions.schema.json` (v1.0) | one line in `actions.ndjson` — audit of every command an agent issued |
| `*.example.{json,ndjson}` | conformant samples |

> **Not to be confused with** `docs/readiness/readiness.schema.json`, which is the
> CI build **verdict** for isextensionready.com. This directory is the **runtime
> session** plane. Different documents, different lifecycles.

## Relationship to the rest of the estate

- **Producers** live in `programs/develop` (`plugin-playwright` writes `ready.json`;
  the dev-server control WS broker writes `logs.ndjson`/`actions.ndjson`) and in
  `extensions/extension-js-devtools` (the sidecar) + the in-bundle dev agent.
- **Consumers** live in `extension-dev/packages/extensiondev-mcp` (the `extension_logs`/
  `extension_eval`/`extension_source_inspect`/… tools) and in the CLI (`extension logs`,
  `extension eval`, …). Per lockstep invariant #1, MCP tools that drive the browser
  shell out to the CLI verb. The bridge is **local and free**; the MCP is just a
  client of the local control WS (it needs no account to observe/act).
- **Platform (separate, auth-gated):** `extension.dev` artifact publishing +
  distribution produces a shareable URL linking the real built artifact. The MCP
  *wraps* these platform APIs (the only auth it imposes). This is NOT a bridge
  backend — it does not emit `log-event`s or speak `control-envelope`. The
  browser-mock/preview-runtime emulator is deprecated for this workflow.

## Drift guard (wire these into CI)

These contracts are only useful if producer and consumer can't silently diverge.
Mirror the pattern already used for the runtime/`ready.json` contract tests
(`programs/extension/__spec__/exec/dev-wait.contract.spec.ts`,
`start-wait.contract.spec.ts`):

1. **Producer conformance** — a unit test validates a real emitted `ready.json` /
   `logs.ndjson` line / `result` frame against the schema here (draft 2020-12,
   e.g. `ajv`). Fails if the producer adds/renames a field without a version bump.
2. **Example conformance** — every `*.example.*` in this dir MUST validate against
   its schema. Cheap canary that the schema itself stays well-formed.
3. **Surface-map parity** — extend the existing `--ai-help` drift guard
   (see `issue: --ai-help contracts`) so each row in `SURFACE.md`'s surface map has
   its CLI flag, MCP tool, and file artifact all present (or an explicit N/A reason).
   Fails if a capability ships on one axis only.
4. **Version monotonicity** — a check that `$id` version == the in-document
   `v`/`schemaVersion`, and that a changed schema bumped both.

Until the guard exists, treat these as design contracts (same status as
`docs/readiness/`): authoritative for implementation, not yet executed at build time.
