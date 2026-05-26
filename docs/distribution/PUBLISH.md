# `extension publish` — producer spec

> How extension.js produces the publish descriptor (`publish-manifest.schema.json`)
> and the hosted URL. The CLI is the source of behavior; `extension_publish` (MCP)
> only wraps this (lockstep invariant #1). Status: design contract, not yet built.

## The free/gated split (maps to the two trust zones)

`extension publish` has two phases, and the line between them is the entire
premium boundary:

| Phase | What | Account? |
|---|---|---|
| **pack** | build → zip → hash → emit `publish-manifest.json` locally | **no** — local + free |
| **host** | upload artifacts → get shareable URL → fill `distribution.url` | **yes** — extension.dev account, auth-gated |

So `extension publish --pack-only` is a free local operation that yields the real
artifacts + a descriptor with `distribution` omitted. Plain `extension publish`
additionally hosts (and is the only part that requires login). This keeps the
"produce artifacts" capability open-source and the "host them on our infra" capability
as the paid seam — consistent with the bridge being free and the platform being gated.

## Pipeline

```
extension publish [path] --browser <list> [--sign] [--pack-only] [--visibility ...]
   │
   1. BUILD   reuse command-build per browser  → dist/<browser>/
   2. PACK    reuse ZipPlugin (plugin-compilation/zip.ts, --zip semantics)
              → dist/<browser>/<name>-<version>.zip   (unsigned)
   3. HASH    sha256 + bytes per artifact
   4. SIGN?   opt-in, per engine (see Signing) — may swap .zip→.xpi
   5. HOST?   unless --pack-only: upload artifacts to the platform
              (cloudflare-deployer / www API) → <workspaceSlug>.extension.dev/<projectSlug>/<sha7>/<browser>.<ext>
   6. EMIT    write dist/publish-manifest.json (validates against the schema)
              + register the descriptor with the platform when hosted
```

Steps 1–3 + 6 are the free `pack`. Steps 4–5 are opt-in/gated.

## CLI surface (reuses existing flags)

```
extension publish [path]
  --browser <list>        # chrome,firefox,edge,… (default: chrome)
  --pack-only             # phase 1 only; emit descriptor, no upload, no account
  --sign                  # attempt per-engine signing (needs creds; see below)
  --visibility <public|unlisted|private>   # default: unlisted
  --zip-filename <string> # already exists on `build`; reused for artifact naming
  --expires <duration|never>               # default: platform policy
```
`--zip` / `--zip-source` semantics are inherited from `build`; `publish` implies `--zip`.

## installability is derived deterministically (browser × signing state)

The producer NEVER hand-sets `installability`; it computes it so the descriptor
can't lie:

| browser | signing.state | → installability |
|---|---|---|
| chrome / edge / chromium-based | unsigned | `chromium-unpacked` |
| chrome / edge | store-signed (CWS/Edge submission) | `store-listed` |
| firefox / gecko-based | unsigned | `firefox-temporary` |
| firefox | store-signed, **unlisted** AMO | `firefox-signed` |
| firefox | store-signed, **listed** AMO | `store-listed` |
| safari | (any) | `safari-convert-required` |

## Signing — the honest state

- **Default (no `--sign`):** every artifact is `unsigned`. Chrome → `chromium-unpacked`,
  Firefox → `firefox-temporary`. The URL is still useful for testers/dev/beta.
- **`--sign` today:** `@extension.dev/deploy` does **store submission** — Chrome Web
  Store, AMO **listed**, Edge. That yields `store-listed`, i.e. the URL points users
  at the store. It does **not** today produce a self-hostable signed `.xpi`.
- **`firefox-signed` (install-straight-from-URL self-distribution) is a NEW capability**
  to add: AMO **unlisted** signing (the web-ext-sign / unlisted versions API that
  returns the signed `.xpi`). Until that lands, `firefox-signed` is unreachable and
  the producer must not emit it. This is the one piece of distribution that the
  current deploy package cannot do — flag it, don't fake it.

## Emission

- `dist/publish-manifest.json` is written even for `--pack-only` (so a no-account
  user still gets a machine-readable descriptor of their artifacts).
- When hosted, the same descriptor is registered with the platform; the platform's
  copy is authoritative for the URL and may be upgraded in place when signing
  completes asynchronously (`unsigned` → `store-signed`, `.zip` → `.xpi`, new `sha256`).

## Decisions made here

- **URL shape (confirmed in www.extension.dev) is `<workspaceSlug>.extension.dev/<projectSlug>/<sha7>/<browser>.<ext>`.**
  The 7-char short `<sha7>` is the build's canonical identity (no separate deployment
  id); `distribution.url` is the browser-agnostic base (`…/<projectSlug>/<sha7>`) and
  each artifact's `downloadUrl` is base + `/<browser>.<ext>` (e.g. `chrome.zip`, `firefox.xpi`).
- **`pack` is free and local; `host` requires an account.** The descriptor is an
  open artifact; hosting is the paid service.
- **`visibility` default = `unlisted`** (link-only). Sharing a build shouldn't index it.

## MCP wrap (the consuming seam — specced next)

`extension_publish({ projectPath, browser?, sign?, visibility? })` shells out to
`extension publish`, requires an extension.dev session for the host phase, and
returns the emitted `publish-manifest.json`. `extension_publish({ packOnly:true })`
needs no auth. The MCP imposes auth ONLY on the host phase — nowhere else.

## What this needs from the other two repos

- **extension.dev:** an upload/host endpoint that accepts the artifacts + descriptor
  and serves them at `<workspaceSlug>.extension.dev/<projectSlug>/<sha7>/<browser>.<ext>`
  (extend `cloudflare-deployer` + the `/api/projects/[id]/deployments` route).
- **extension-mcp:** the `extension_publish` tool + generating its descriptor type
  from `publish-manifest.schema.json` (no hand-written drift).
- **extension.js (this repo):** the `publish` command (steps 1–3,6 reuse existing
  build/zip), and — separately — AMO unlisted signing to unlock `firefox-signed`.
