# Agent Bridge — surface spec

> The contract that lets a terminal LLM (and a human, and any file-reading tool)
> observe and act on the data an Extension.js dev build generates in **a real
> local browser**.
>
> Motivation: Chrome DevTools Protocol and Playwright are page-centric and can't
> cleanly reach extension surfaces (service worker, isolated content world,
> popup/options/sidebar). Extension.js can, because it owns two privileged
> injection points locally.
>
> **Scope boundary (important):** the entire observe + act bridge is a **free,
> local, open-source extension.js capability**. There is no hosted relay and no
> emulated backend. The MCP is just one *client* of this local bridge — it reads
> `ready.json` and connects to the local control WS exactly as it consumes
> `ready.json` today. The **extension.dev platform** (artifact publishing +
> distribution to a shareable URL) is a separate, auth-gated/possibly-premium
> concern that the MCP *wraps* — see "Platform vs bridge" below.

## The two injection points (local)

| Point | What it is | Reaches |
|---|---|---|
| **Sidecar** | separate companion extension `extensions/extension-js-devtools`, auto-loaded in dev (`programs/develop/lib/extensions-to-load.ts`). Perms: `management,tabs,storage,webNavigation` + `<all_urls>`. **No `debugger`/`scripting`.** | shared page DOM (own content script); brokers to the dev-server WS; holds the sidebar UI + log buffer |
| **In-bundle dev agent** | instrumentation compiled INTO the user's dev bundle (reload/content-script-wrapper) — runs with the **user extension's identity** | background SW, popup/options/sidebar, isolated content world, the user's own `chrome.storage` |

Logs already cross in-bundle → sidecar today. The bridge generalizes that one
channel to also carry inspect/eval/storage requests. All of it is localhost.

> The browser-mock / preview-runtime emulator is **deprecated as a bridge
> backend.** There is no second, hosted, emulated backend to inspect or act on.
> Tools operate only on a local session (`{projectPath}`).

## Three consumption tiers, one local data plane

A developer never picks a mode up front. They run `extension dev` the same way;
each tier is a strict superset of the one above and the lower tiers keep working
untouched. All three are local and free.

| Tier | Observe | Act | Setup |
|---|---|---|---|
| Sidebar UI | human, live | manual (browser) | none — auto |
| Files-as-contract (`*.ndjson`, `ready.json`) | agent, pull/poll | manual (edit source) | none — auto |
| MCP tools | agent, live stream | `eval`/`reload`/`storage`/`open` | install `@extension.dev/mcp` once |

## Platform vs bridge (where premium lives)

| | Bridge (this spec) | Platform (extension.dev) |
|---|---|---|
| What | observe + act on the local dev browser | publish + distribute the built artifact to a shareable URL |
| Cost | free, open-source, local, no auth | auth-gated, possibly premium |
| MCP role | client of the local control WS | wrapper over platform APIs — the **only** place MCP requires auth |
| Network | localhost only | hosted |

The shareable URL serves the **real built artifact** (e.g. `.xpi`/`.zip`/`.crx`) —
distribution, not an in-browser simulation. Highest value for Firefox
self-distribution, enterprise, and tester/beta channels.

## The contracts (this directory)

| File | `$id` version | Producer | Consumers |
|---|---|---|---|
| `log-event.schema.json` | 1.0 | in-bundle agent / preview host | sidebar, `logs.ndjson`, `extension_logs` |
| `control-envelope.schema.json` | 1.0 | broker / sidecar / controller | MCP, `extension logs --follow`, relay |
| `ready-contract.schema.json` | 2.0 | `plugin-playwright` (dev server) | `extension_wait` + all bridge tools (discovery) |
| `actions.schema.json` | 1.0 | broker | `actions.ndjson` (human audit) |

Change any of these only by bumping the version in `$id` + the `v`/`schemaVersion`
field. The drift guard (see README) fails CI otherwise.

## Surface map — CLI ↔ MCP ↔ file, in lockstep

Legend: ✅ exists · 🔨 to build · — N/A by design

### Logs / observability
| Capability | CLI | MCP tool | File |
|---|---|---|---|
| Level / context / url / tab filters | `--logs`, `--log-context`, `--log-url`, `--log-tab` ✅ | `extension_logs({level,context,url,tab})` 🔨 | — |
| Tail past + live | `extension logs --follow` 🔨 | `extension_logs({since,follow})` 🔨 | `logs.ndjson` (default-on, rotated) 🔨 |
| Diagnostics only | `extension logs --signals-only` 🔨 | `extension_logs({signalsOnly:true})` 🔨 | filter on `eventType=dx.signal` |

### Source / DOM inspection
| Capability | CLI | MCP tool | File |
|---|---|---|---|
| Inspect surface/page | `--source [url]`, `--watch-source` ✅ | `extension_source_inspect` ✅ (CDP → sidecar 🔨) | — |
| Closed-shadow pierce | `--deep-dom` 🔨 (Chromium only) | `extension_source_inspect({deepDom:true})` 🔨 | — |

### Act
| Capability | CLI | MCP tool | File |
|---|---|---|---|
| Eval in context | `extension eval --context <c>` 🔨 | `extension_eval` 🔨 | `actions.ndjson` 🔨 |
| Storage get/set | `extension storage <get\|set>` 🔨 | `extension_storage` 🔨 | `actions.ndjson` |
| Reload / open surface | `extension reload`, `extension open <s>` 🔨 | `extension_reload`, `extension_open` 🔨 | `actions.ndjson` / `events.ndjson` |

### Distribution (platform — auth-gated/possibly premium)
| Capability | CLI | MCP tool | Output |
|---|---|---|---|
| Publish artifact → shareable URL | `extension publish` 🔨 | `extension_publish` 🔨 (auth-gated) | URL linking the real `.xpi`/`.zip`/`.crx` |
| Store submission | `@extension.dev/deploy` CLI ✅ | `extension_deploy_store` 🔨 (auth-gated) | store submission ids |

> These are platform wrappers, not bridge tools. They require an extension.dev
> account; they do NOT observe or act on a running browser.

## The three lockstep invariants (CI-enforceable)

1. **MCP tools that wrap long-running browser work shell out to the CLI verb**
   (as `dev`/`start`/`preview` already do). The CLI is the single source of behavior;
   the MCP cannot drift from it.
2. **Anything an agent observes or does is also a file** — `ready.json`,
   `events.ndjson`, `logs.ndjson`, `actions.ndjson`. This is the no-MCP (Tier-2)
   guarantee: an agent with only filesystem access still gets the full read path.
3. **`--ai-help` output and the MCP tool list are generated from one registry.**
   Extend the existing AI-help drift guard to cover every row in the surface map
   above, so a new capability can't ship on one axis only.

> Rule for new capabilities: fill the CLI / MCP / file columns, or mark a column
> N/A **with a reason**. A capability that is MCP-only or CLI-only is a bug.

## One local backend

Every read/act tool operates on a local session, addressed by `{projectPath}`:

| Address | Backend | Engine | Auth |
|---|---|---|---|
| `{projectPath}` | local sidecar + in-bundle agent | chrome / firefox | localhost + `instanceId`; `eval` adds local 0600 token |
| `{projectPath, deepDom:true}` | local CDP (closed-shadow pierce escape hatch) | chromium only | same |

There is no remote/`{deployUrl}` backend — distribution (above) produces an
artifact URL, not an inspectable running runtime.

## Auth (local bridge needs almost none; platform needs an account)

- **Bridge — logs (producer/consumer):** `instanceId` only (localhost shared secret).
- **Bridge — bounded act (storage/reload/open/tabs):** `instanceId` + `--allow-control`.
- **Bridge — `eval`:** `--allow-eval` + a per-session token written `0600` **outside
  `dist/`** (never shipped in a build). Still entirely local — no account involved.
- **Platform — publish/distribute/store:** extension.dev account; auth-gated and
  possibly premium. This is the *only* auth the MCP imposes, and it never touches
  the observe/act path.

## Honesty rules (surface limits, never hide them)

- **Dropped logs** → a `gap` frame + a `seq` jump. Two independent signals; zero silent loss.
- **Closed shadow roots** in the default (sidecar) path → result carries `degraded`
  + the `shadow` level actually delivered. Recover via `--deep-dom` on Chromium.
- **Engine gaps** → capability negotiation reports what the engine supports
  (e.g. Firefox MV2 has no `sidePanel`); an unsupported op returns
  `{error:{name:"Unsupported",engine:"firefox"}}` rather than a mystery failure.

## Build order (slices — each reuses the prior, none reopens its contract)

1. **Logs** — broker + ring buffer (drop-oldest, gap-honesty, slow-reader isolation,
   coalescing), `log-event` v1, `logs.ndjson` (8 MB/50k-line rotate, keep 3), `ready-contract` v2,
   `extension_logs` + `extension logs --follow`. First persistent MCP session layer.
2. **Act** — `command`/`result` envelope + `role:controller`, `actions.ndjson`, the
   auth token. Same socket/handshake/ring as Slice 1.
3. **Inspect** — transport-agnostic `SourceExtractor` (sidecar default, CDP `--deep-dom`),
   surface addressing, console-from-buffer. Same socket/addressing; reuses all of
   `source-output.ts` formatting so the output contract is unchanged. Adds Firefox.

Slices 1–3 are the whole local bridge — free, open-source, no account.

**Separate track (platform, not a bridge slice):** artifact publish + distribution
to a shareable URL (`extension publish` / `extension_publish`), auth-gated via the
extension.dev account. Wraps the platform; does not observe or act on a browser.
The browser-mock/preview-runtime emulator is deprecated for this workflow.
