# Distribution — publish descriptor + cross-repo seam map

## The publish descriptor

`publish-manifest.schema.json` (v1.0) describes a published build: which artifacts
exist, their **signing + installability per engine**, and where the shareable URL
serves them. Called the *publish descriptor* in prose to avoid confusion with the
extension's own `manifest.json`.

It is produced by **extension.js** (`extension publish`), hosted/rendered by the
**extension.dev** platform, and wrapped (auth-gated) by **extension-mcp**
(`extension_publish`). It is the seam those three meet at.

### The honest install matrix (why `installability` exists)

`extension build` emits an **unsigned `<name>-<version>.zip` for every engine**
(`programs/develop/plugin-compilation/zip.ts`). Whether a *normal user* can install
that from a URL depends on signing, which differs hard by engine:

| Engine | Unsigned (just built) | After store/AMO signing |
|---|---|---|
| Chrome / Edge | `chromium-unpacked` — load-unpacked, devs/testers only (off-store `.crx` is blocked) | `chromium-store-only` / `store-listed` — normal users install from the Web Store |
| Firefox | `firefox-temporary` — loads only via about:debugging / Developer Edition | `firefox-signed` — AMO-signed `.xpi`, **installable directly from the URL** (true self-distribution) |
| Safari | `safari-convert-required` — needs Xcode conversion | store-listed |

So the shareable URL's real value is sharpest for **Firefox self-distribution** and
for **tester/beta channels** (load-unpacked). For normal Chrome users it's a path to
the store, not an install. The descriptor states this per artifact instead of
implying "click to install" uniformly — the same honesty discipline as the bridge.

### Signing is a descriptor upgrade, not a separate document

`extension build` → `signing.state: "unsigned"`. Running the platform/AMO path
(`@extension.dev/deploy`) signs the Firefox artifact, swaps `.zip`→`.xpi`, and
**updates this descriptor in place** (`state: "store-signed"`, new `sha256`,
`installability: "firefox-signed"`). One descriptor, evolving — readers re-fetch.

## Cross-repo seam map (the glue, piece by piece)

Five contracts connect the three repos. Each is a seam where one repo produces and
another consumes — change them only by version bump.

```
                 extension.js (CLI + dev bridge)        extension.dev (platform)        extension-mcp (@extension.dev/mcp)
                 ─────────────────────────────────      ────────────────────────        ─────────────────────────────────
ready-contract   produces dist/.../ready.json  ───────────────────────────────────────▶ extension_wait / discovery (reads)
log-event        produces logs.ndjson + WS stream ─────────────────────────────────────▶ extension_logs (subscribes)
control-envelope dev-server control WS (local) ◀───────────────────────────────────────▶ extension_eval/storage/inspect (client)
publish-manifest produces via `extension publish` ────▶ hosts/renders the URL  ─────────▶ extension_publish (wraps, AUTH-GATED)
templates-meta   (lives in examples repo) ────────────▶ catalog source  ────────────────▶ extension_list_templates / get_source
readiness        CI verdict (docs/readiness) ─────────▶ isextensionready.com badge
```

**Two trust zones:**
- **Local + free** (the four bridge seams above the line): `ready-contract`,
  `log-event`, `control-envelope`. The MCP is a plain client; no account.
- **Platform + auth-gated** (below): `publish-manifest`. The MCP imposes auth ONLY
  here. This is the entire premium boundary.

**Where each contract is authoritative:**

| Contract | Schema home | Producer | Primary consumers |
|---|---|---|---|
| `ready-contract` | `docs/agent-bridge/` | extension.js `plugin-playwright` | MCP `extension_wait`, all bridge tools |
| `log-event` | `docs/agent-bridge/` | in-bundle agent → sidecar → broker | sidebar, `logs.ndjson`, MCP `extension_logs` |
| `control-envelope` | `docs/agent-bridge/` | dev-server control WS broker | MCP act/inspect tools, `extension logs --follow` |
| `publish-manifest` | `docs/distribution/` (here) | extension.js `extension publish` | extension.dev hosting, MCP `extension_publish` |
| `templates-meta` | examples repo | `generate-templates-meta.mjs` | MCP `extension_list_templates`, CLAUDE.md |
| `readiness` | `docs/readiness/` | CI | isextensionready.com |

## Drift guard

Same pattern as `docs/agent-bridge/README.md`: validate a real emitted descriptor +
this `*.example.json` against the schema (ajv, draft 2020-12) in CI; enforce
`$id` version == in-document `v`. The MCP's publish-related types in
`extension-dev/packages/extensiondev-mcp` should be generated from / checked against
this schema so the producing and wrapping repos can't drift.
