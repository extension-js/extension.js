# Implementation spec: Firefox add-on id — harden the banner fallback

**Status:** open · **Severity:** very low (cosmetic — dev-banner id only; no functional misattachment) · **Area:** `run-firefox/rdp/remote-firefox` id derivation
**Owner:** unassigned · **Created:** 2026-07-01 · **Updated:** 2026-07-01 (investigation → spec) · **Repo:** `extension.js`

This is a self-contained handoff. You should not need the originating conversation.

---

## TL;DR (re-scoped after reading the code)

The original question was "Chromium has an extension-ownership tri-state; does
Firefox need an equivalent?" **After reading the Firefox flow, the answer is
essentially no — and the residual gap is smaller and lower-stakes than feared.**

- Firefox **already prefers the authoritative id** returned by the RDP
  `installTemporaryAddon` response (`installResponse.addon.id`). Target scanning is
  only a **fallback** when that response has no id.
- The fallback (`deriveMozExtensionId`) is **"first `moz-extension://` target
  wins,"** with no disambiguation — so in a profile that already contains another
  add-on it could pick the wrong host. **But** the derived id is used **only to
  print the dev banner** — it does not reach `ready.json`, unified logging, or
  reload. Worst case is a wrong id *string in the banner*, not a misattached
  session.

So there is **no ownership tri-state to port**. The only concrete, implementable
change is to make the banner fallback refuse to guess when it can't disambiguate.
This spec defines exactly that. If you'd rather not spend effort on a cosmetic
edge case, "won't fix / document" is a legitimate close.

## Verified current behavior (file:line)

`programs/extension/browsers/run-firefox/rdp/remote-firefox/index.ts` — `installAddons`:

```ts
const installResponse = await installTemporaryAddon(client, addonsActor, addonPath, isDevtoolsEnabled) // :234
const maybeIdRaw = installResponse?.addon?.id                                                          // :241
const maybeId = typeof maybeIdRaw === 'string' && maybeIdRaw.length > 0 ? maybeIdRaw : null            // :242
if (primaryAddonPath && String(addonPath) === String(primaryAddonPath) && maybeId) {
  primaryUserAddonId = maybeId                                                                          // :251  (authoritative, per-install)
}
...
if (primaryUserAddonId) { this.derivedExtensionId = primaryUserAddonId }                                // :265-267  (provenance wins)
try {
  if (!this.derivedExtensionId) {
    this.derivedExtensionId = await deriveMozExtensionId(client)                                        // :272  (FALLBACK — the gap)
  }
} catch {}
...
await printRunningInDevelopmentSummary(candidateAddonPaths, 'firefox', this.derivedExtensionId, ...)    // :279-284  (only consumer)
```

- RDP install response shape is confirmed:
  `addons-install.ts` `installTemporaryAddon` returns `{addon?: {id?: string}}` (`:96`, `return … as {addon?: {id?: string}}` `:136`).
- The fallback: `moz-id.ts` `deriveMozExtensionId(client)` = `getTargets()` → **first**
  target whose url starts with `moz-extension://` → its `URL.host`. No
  disambiguation, no provenance check.
- Blast radius: `derivedExtensionId` is a **private field** (`index.ts:51`) whose
  only read is the banner call at `:282`. Grep confirms no external getter, no
  `ready.json` / logging / reload consumer.

Chromium reference (for contrast, not to copy):
`programs/extension/browsers/run-chromium/cdp/cdp-extension-controller/ownership.ts`
`classifyExtensionOwnership` — needed there because Chrome *discovers* the unpacked
id from a shared profile and must verify ownership against `Preferences`. Firefox's
install-provenance sidesteps that entirely for the functional paths.

## The change

Make the fallback provenance-aware: adopt a scanned id **only when it is
unambiguous**, otherwise leave it undefined (banner prints without an id rather
than a wrong one).

### 1. Turn `deriveMozExtensionId` into a pure, disambiguating picker

`moz-id.ts` — replace the "first match" body with an explicit rule and make the
core logic a pure function so it's unit-testable without RDP:

```ts
// Pure core — no client, unit-testable.
export function pickMozExtensionHost(
  targetUrls: Array<string | undefined>,
  opts?: {managerHostPattern?: RegExp}
): string | undefined {
  const hosts = targetUrls
    .map((u) => { try { return u && u.startsWith('moz-extension://') ? new URL(u).host : undefined } catch { return undefined } })
    .filter((h): h is string => !!h)
  const unique = Array.from(new Set(hosts))
  const managerRe = opts?.managerHostPattern
  const nonManager = managerRe ? unique.filter((h) => !managerRe.test(h)) : unique
  // Unambiguous only: exactly one candidate (prefer non-manager). Otherwise refuse to guess.
  if (nonManager.length === 1) return nonManager[0]
  if (unique.length === 1) return unique[0]
  return undefined
}

export async function deriveMozExtensionId(client: MessagingClient): Promise<string | undefined> {
  try {
    const targets = (await client.getTargets()) as Array<{url?: string}>
    return pickMozExtensionHost((targets || []).map((t) => t?.url))
  } catch { return undefined }
}
```

Note: a `moz-extension://` **host is not the add-on id** (it's a per-session UUID),
so there is no manager-vs-user disambiguation by id available here — the manager
pattern arg is a hook only if a future manager target is identifiable by some other
signal; if not, drop the arg and keep the "exactly one target" rule. Deciding that
is part of the task (see open question below).

### 2. Warn (author mode) when the fallback is exercised at all

At `index.ts:271`, the fact that we reached the fallback means the install response
gave us no id — worth a one-line author-mode warning so a real regression in the
install response is visible instead of silently degrading to a scanned/absent id:

```ts
if (!this.derivedExtensionId) {
  this.derivedExtensionId = await deriveMozExtensionId(client)
  if (process.env.EXTENSION_AUTHOR_MODE === 'true' && !this.derivedExtensionId) {
    console.warn('[browser] Firefox: could not resolve a unique add-on id for the banner (install response had none; multiple/zero moz-extension targets).')
  }
}
```

### 3. Open question the implementer must resolve first

Confirm **when, if ever, `installResponse.addon.id` is empty** on supported Firefox
(≥ the versions we target). Read the RDP `installTemporaryAddon` reply on a real
run (or a captured frame). If it is *always* populated, the fallback is effectively
dead and the change is pure defense — in that case prefer the smaller diff
(disambiguating picker + warn) and skip any manager-pattern machinery. If it can be
empty, the picker's "refuse to guess" rule is the actual behavior fix.

## Unit test (no live browser needed)

New `moz-id.unit.spec.ts` around `pickMozExtensionHost`, mirroring
`run-chromium/cdp/.../ownership.unit.spec.ts` structure:

- one `moz-extension://<uuid>/…` target → returns that host.
- two distinct `moz-extension://` hosts → returns `undefined` (refuses to guess).
- zero `moz-extension://` targets (only `about:`/http targets) → `undefined`.
- malformed url mixed with one valid → returns the valid host.
- (if manager pattern is kept) one user + one manager host → returns the user host.

## Where should this be built — here (extension.js) or the MCP?

**Here, in the CLI.** The banner is printed by the CLI's Firefox controller, and the
id is a launch-time artifact the CLI owns. The MCP (`@extension.dev/mcp`) never sees
`derivedExtensionId` — it reads the authoritative id/port from `ready.json` (written
by the CLI) and attaches; it has no banner and no role in id derivation. Building
anything here in the MCP would be wrong-layer. (This is the same conclusion as the
functional-ownership question: identity is a CLI launch-lifecycle concern.)

## Validation (the part an AI cannot fully self-serve)

Unit tests above are self-contained. The **only** real-browser check — and it needs
a human or CI with a display — is: launch `dev --browser=firefox` against a
persisted profile that already has another temporary add-on installed, and confirm
the banner shows our add-on's id (or no id) rather than the pre-existing add-on's
host. This can't be reproduced headlessly here (Firefox RDP + real profile state),
so an implementing agent should ship the code + unit tests and hand the browser
check to CI/human.

## History

- 2026-07-01: Created as an investigation note while removing the source-inspection
  feature and pairing the chromium/firefox controllers.
- 2026-07-01: Upgraded to this spec after reading the install flow — the functional
  ownership concern dissolved (install-provenance id is preferred; the scanned id is
  banner-only), leaving a small, well-scoped fallback-hardening change.
