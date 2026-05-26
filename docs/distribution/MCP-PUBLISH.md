# `extension_publish` — MCP tool contract

> The consuming seam. Wraps the `extension publish` CLI (PUBLISH.md). Lives in
> `extension-dev/packages/extensiondev-mcp/src/tools/publish.ts`, registered in
> `src/index.ts`. This is the MCP's FIRST auth-gated tool — everything else is
> local/free. Status: design contract, not yet built.

## It shells out to the CLI (lockstep invariant #1)

`extension_publish` does NOT talk to the extension.dev platform directly. Like
`dev`/`start`/`preview` (which `spawnExtensionCli`), it spawns `extension publish`
and lets the CLI own build + pack + host. One hosting code path, no duplicate
platform client in the MCP. The MCP's only added responsibility is **passing the
auth token through** and **shaping the result**.

## Tool schema (matches the existing 15-tool convention)

```json
{
  "name": "extension_publish",
  "description": "Build, package, and (optionally) host an extension as a shareable distribution URL. packOnly=true produces artifacts + a publish descriptor locally with NO account. Hosting requires an extension.dev session. Returns the publish-manifest descriptor.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "projectPath": { "type": "string", "description": "Path to the extension project root" },
      "browser": {
        "type": "array",
        "items": { "enum": ["chrome", "edge", "firefox", "chromium-based", "gecko-based"] },
        "default": ["chrome"],
        "description": "Browsers to build + package"
      },
      "packOnly": {
        "type": "boolean",
        "default": false,
        "description": "Produce artifacts + dist/publish-manifest.json locally and STOP. No upload, no account."
      },
      "sign": {
        "type": "boolean",
        "default": false,
        "description": "Attempt per-engine signing. Note: firefox-signed (install-from-URL) is not yet available; firefox falls back to firefox-temporary."
      },
      "visibility": {
        "enum": ["public", "unlisted", "private"],
        "default": "unlisted"
      }
    },
    "required": ["projectPath"]
  }
}
```

The `handler(args)` returns `JSON.stringify(<publish-manifest>)` (the descriptor
defined by `publish-manifest.schema.json`) plus a `hint`, matching how the other
tools return structured JSON strings.

## Auth — the only place the MCP requires it

The MCP has **no** auth concept today (deps are just extension-create/develop/install
+ ws). This tool introduces one, shared with the CLI so there's a single source:

- **`extension login`** (new CLI verb) performs the extension.dev OAuth/device flow
  and writes a token to a standard path, `~/.config/extension-dev/auth.json` (mode
  `0600`), with `{ token, account, expiresAt }`.
- The **CLI host phase** reads that file. The **MCP** does not read or store the token
  itself — it just spawns `extension publish`, which picks the token up. (Optionally
  the MCP forwards `EXTENSION_DEV_TOKEN` from its own env for headless/CI.)
- **`packOnly:true` needs nothing.** Auth is required only when hosting.

So the token never lives in the MCP process or a tool argument — it stays in the
CLI's auth file. The MCP is auth-*aware*, not auth-*holding*.

## Behavior

```
extension_publish({ projectPath, browser, packOnly, sign, visibility })
  1. spawn: extension publish <projectPath> --browser <list>
            [--pack-only] [--sign] --visibility <v>
  2. on success: read dist/publish-manifest.json, return it (+ hint)
  3. on auth failure (host phase, no token): return structured auth_required
```

## Result + error taxonomy (structured, never a bare throw)

```jsonc
// success (hosted)
{ "status": "published", "url": "https://<workspaceSlug>.extension.dev/<projectSlug>/<sha7>",
  "manifest": { /* publish-manifest */ },
  "hint": "Firefox artifact is firefox-temporary (unsigned). firefox-signed self-distribution is not yet available." }

// success (pack-only)
{ "status": "packed", "manifestPath": "dist/publish-manifest.json",
  "manifest": { /* publish-manifest, distribution omitted */ } }

// auth required (host attempted, no session)
{ "status": "auth_required",
  "error": "Hosting a distribution URL requires an extension.dev account.",
  "hint": "Run `extension login`, or call extension_publish with packOnly:true to produce artifacts locally without an account." }

// honest capability gap
{ "status": "error", "code": "firefox_signed_unavailable",
  "error": "firefox-signed (install-from-URL) needs AMO unlisted signing, not yet implemented.",
  "hint": "Use the produced firefox-temporary artifact (about:debugging), or submit to AMO listed via the store path." }
```

## Type generation (no hand-drift)

`publish-manifest.schema.json` is authoritative. Generate the MCP's `PublishManifest`
TypeScript type FROM it (`json-schema-to-typescript`) into
`extensiondev-mcp/src/lib/types.ts` — same treatment recommended for the existing
hand-written `ReadyContract` there. A CI step regenerates and `git diff --exit-code`s,
so the producing repo (extension.js) and the wrapping repo (extension-dev) cannot drift.

## Registration

Add to `src/index.ts` tools array under a new **platform** tier (alongside the future
`extension_deploy_store`). It is the first tool whose handler can return
`auth_required` — document that tier as "auth-gated" so the distinction from the
free local tools is explicit in the tool list and in `claude/rules/mcp-tools.md`.

## Surface-map row (closes the lockstep)

| Capability | CLI | MCP tool | File/output |
|---|---|---|---|
| Publish artifact → shareable URL | `extension publish` | `extension_publish` (auth-gated host; free packOnly) | `dist/publish-manifest.json` + hosted URL |

All three columns are filled — the publish seam is now defined end to end:
producer (`extension publish`) → descriptor (`publish-manifest.json`) → wrapper
(`extension_publish`).
