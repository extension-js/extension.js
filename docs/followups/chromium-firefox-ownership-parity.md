# Follow-up: Chromium has extension-ownership tri-state; Firefox has no equivalent

**Status:** open · **Severity:** low (correctness hardening / DX; no known incorrect behavior today) · **Area:** browser attach/identity — chromium `cdp-extension-controller` vs firefox `rdp-extension-controller`
**Owner:** unassigned · **Created:** 2026-07-01 · **Repo:** `extension.js`

This is a self-contained handoff. You should not need the originating conversation.

---

## TL;DR

After launching a browser, the CLI's per-browser controller has to answer one
question before it adopts an extension id for logging / reload / the dev banner:
**"is this discovered extension actually the one I'm developing, or something else
already in this browser?"**

- **Chromium answers it explicitly** with an ownership *tri-state*
  (`'mine' | 'not_mine' | 'unknown'`) in
  `chromium-source-inspection/cdp-extension-controller/ownership.ts`
  (`classifyExtensionOwnership`). It has to, because Chrome assigns unpacked
  extensions an id that must be **discovered** from the profile, and a reused /
  populated profile can contain other extensions. `unknown` is deliberately *not*
  a yes — callers defer/retry/re-derive rather than adopt an id on trust.
- **Firefox has no equivalent.** The RDP `installTemporaryAddon` flow returns the
  authoritative id directly (the controller derives the `moz-extension://` host
  from the install), so it never disambiguates against a shared profile.

So this is **not a missing capability** so much as: Chromium solves an
identity-ambiguity problem that the Firefox temporary-addon flow mostly sidesteps.
The open question is whether Firefox has residual exposure to the *same class of
bug* (adopting the wrong extension) and, if so, whether it deserves a parallel
guard. **Recommendation for where any such guard belongs: here in the CLI, not the
MCP** (see "Where should this be built").

## Background: what Chromium does and why

`classifyExtensionOwnership(profilePath, outPath, extensionId)` reads the Chrome
profile's `Preferences` JSON (`extensions.settings[id].path`) and compares the
stored install path to the dev build's `outPath`:

- `'mine'` — a `Preferences` file maps the id to `outPath`.
- `'not_mine'` — a `Preferences` file maps the id to a **different** path
  (verifiably someone else's extension).
- `'unknown'` — can't tell yet: no profile path, no `Preferences` on disk yet, or
  the id is absent from every `Preferences` file (a freshly created profile hasn't
  flushed its bookkeeping).

`CDPExtensionController` funnels every ownership question through this one decision
(`index.ts` `classifyOwnership`, used in `ensureLoaded` and the best-effort info
path): on `not_mine` it rejects the id; on `unknown` with a profile it defers /
re-derives rather than trusting it. This is what stops the controller from
attaching its logging/reload to a *pre-existing* extension when the dev browser
reuses a populated profile.

## Why Firefox currently gets away without it

`FirefoxRDPController.ensureLoaded` → `RemoteFirefox.installAddons` installs the
build as a **temporary add-on** over RDP and reads the id back from the install
result / the `moz-extension://` target (`moz-id.ts` `deriveMozExtensionId`).
Because the id comes from *the install this session just performed*, there is no
"whose id is this?" ambiguity to resolve against persisted profile state, and
temporary add-ons don't persist across restarts.

## The real question to evaluate later

Does Firefox have residual exposure to adopting the wrong add-on? Candidate
scenarios worth probing before deciding to build anything:

1. **System / reused profile with a pre-installed copy** of the same or another
   add-on (`EXTENSION_USE_SYSTEM_PROFILE`, `--profile <persisted>`). Does
   `deriveMozExtensionId` / the `moz-extension://` target selection ever pick a
   target that isn't the one we just installed?
2. **Multiple `moz-extension://` targets** present (our add-on + `-manager` +
   anything else). The install ordering handles user-first-vs-manager, but confirm
   the id we adopt is provably the one from *our* `installTemporaryAddon` response,
   not just "the first moz-extension target."
3. **Partial / retried install.** If install is retried, is there a window where an
   earlier or stale target could be adopted?

If all three are provably safe (the RDP install response is always the authoritative
source), then there is **no parity work to do** — document that and close this.
If any is exploitable, the fix is a Firefox-side "adopt only the id the install
returned" assertion — the RDP analogue of the tri-state, but simpler (identity by
install-provenance rather than by `Preferences` path-match).

## Where should this be built — here (extension.js) or the MCP?

**Here, in the extension.js CLI (the `run-firefox` controller).** Reasoning:

- Extension **identity + teardown ownership is a launch-lifecycle concern**. The
  CLI is what launches the browser, installs/loads the extension, and must name
  "its" extension among any others. That is exactly where Chromium's tri-state
  lives, and the Firefox analogue belongs in the symmetric place
  (`rdp-extension-controller` / `RemoteFirefox`).
- **The MCP (`@extension.dev/mcp`) is a downstream consumer, not a launcher.**
  `extension_source_inspect` / `extension_list_extensions` attach to a browser the
  CLI *already* launched and read the authoritative id + CDP/RDP port from the
  session's `ready.json` (written by the CLI). The MCP owns no launch and no
  teardown, so it cannot and should not re-derive identity — if the CLI establishes
  the correct id, the MCP inherits it for free.
- Corollary: building this in the MCP would be wrong-layer and would only paper
  over a CLI-side misidentification, not fix it. Fix it once, in the CLI, and every
  consumer (banner, unified logging, reload, and the MCP) benefits.

## Where (code pointers)

- Chromium reference implementation:
  `programs/extension/browsers/run-chromium/chromium-source-inspection/cdp-extension-controller/ownership.ts`
  and its call sites in the same dir's `index.ts` (`classifyOwnership`).
- Firefox side to (potentially) harden:
  `programs/extension/browsers/run-firefox/firefox-source-inspection/rdp-extension-controller/index.ts`,
  `.../remote-firefox/index.ts` (`installAddons`), `.../remote-firefox/moz-id.ts`
  (`deriveMozExtensionId`).
- Consumer that must NOT own this (for context):
  `@extension.dev/mcp` `src/tools/source-inspect.ts` / `list-extensions` (reads
  `ready.json`; attaches, never launches).

## Validation (if pursued)

1. Launch `dev --browser=firefox` against a **persisted profile that already has a
   different temporary/permanent add-on**, and assert the controller's adopted id
   is the one from our install, not the pre-existing one (mirror of the Chromium
   `not_mine` rejection test in `ownership.unit.spec.ts`).
2. Add a unit test around `deriveMozExtensionId` with multiple `moz-extension://`
   targets present, asserting install-provenance wins over "first target."
3. If a guard is added, keep it a pure function (like `classifyExtensionOwnership`)
   so it's unit-testable without a live browser.

## History

- 2026-07-01: Surfaced while removing the unwired source-inspection feature and
  pairing up the chromium/firefox controllers. The dead-code removal left both
  controllers with a symmetric live core (`ensureLoaded` + `enableUnifiedLogging`);
  the ownership tri-state is the one genuine *live* asymmetry (chromium-only). It's
  a deliberate feature question rather than a mechanical pairing, hence this note.
