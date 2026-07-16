# Follow-up: Firefox launcher gate — at-launch content-script injection race

**Status:** RESOLVED (2026-06-29) — root cause was a launched-Firefox RDP port
double-derivation, NOT an injection race. Fix landed. See "Resolution" below.
· **Severity:** was high (launched-Firefox add-on install silently never
completed when no `instanceId`), mis-filed as low · **Area:** Firefox launch RDP
port resolution + `firefox-content-reload` e2e gate
**Owner:** unassigned · **Created:** 2026-06-29 · **Repos:** `extension.js` (launcher) + `_FUTURE/examples` (the gate)

This is a self-contained handoff. You should not need the originating conversation.

---

## Resolution (2026-06-29)

The original TL;DR below (an "at-launch injection race") was **wrong**. The gate's
Step-1 mount probe failed because the launched Firefox **never installed the
extension.js add-on at all** — so there was no content script to mount, on the
starting tab or any reload of it.

**Verified root cause — RDP port double-derivation.** Firefox was launched with
its debugger server on port **9230** (`Started devtools server on 9230`), but the
add-on installer tried to connect to **9330**:

```
[browser] Firefox RDP setup retry 1/5: connect ECONNREFUSED 127.0.0.1:9330
```

`deriveDebugPortWithInstance(p) = (p + PORT_OFFSET) + instanceOffset`. The launcher
resolves the concrete port (9230, via `findAvailablePortNear`) and constructs the
RDP controller with it — but `RemoteFirefox.resolveRdpPort()` ran that
already-concrete port through `deriveDebugPortWithInstance` **again**, re-adding
`PORT_OFFSET` (100) → 9330. The instance registry would normally override this,
but a plain `extension dev --browser=firefox` run has **no `instanceId`**, so it
fell through to the doubly-derived port. With `RDP_MAX_RETRIES=150 ×
RDP_RETRY_INTERVAL_MS=1000`, this was a **silent ~150s stall** (the ECONNREFUSED
retry branch logs nothing) that masked the cause — the gate just timed out at
Step 1.

**Fix (product).** Added a dedicated `resolvedRdpPort` channel to `RemoteFirefox`:
the launcher hands the controller the concrete launched port and it is used
verbatim, never re-derived. The instance-registry override still wins when an
`instanceId` is registered (per-instance faithfulness preserved).

- `programs/extension/browsers/run-firefox/rdp/remote-firefox/index.ts`
  — new `resolvedRdpPort` option + short-circuit in `resolveRdpPort`.
- `programs/extension/browsers/run-firefox/rdp/rdp-extension-controller/index.ts`
  — pass the concrete `debugPort` as `resolvedRdpPort`.
- `programs/extension/browsers/__spec__/instance-port-fidelity.unit.spec.ts`
  — 3 regression tests (pinned port used verbatim; not re-derived; registry still
  overrides). The pre-existing base-port derivation contract is untouched (those
  callers pass no `resolvedRdpPort`).

**Fix (test, complementary).** `template.firefox-content-reload.spec.ts` now
reloads the starting tab once post-readiness (mirrors the Chromium gate's
fresh-tab approach) as a de-flake guard for the documented race. With the product
fix the add-on now mounts at launch, so this is belt-and-suspenders, not the
primary fix.

**Validation:** unit specs green (`instance-port-fidelity` 18/18, `run-firefox`
74/74); rebuilt CLI now installs the add-on and mounts the content script at
launch headless in the slow sandbox; `firefox-content-reload` gate passes; the
self-launch harness still passes.

Everything below is the **original (now-superseded) analysis**, kept for the
provenance trail. Treat its "Root cause" and "Candidate approaches" sections as
historical — the real cause was the port bug above.

---

## TL;DR (original — superseded)

The Playwright project `firefox-content-reload` validates content-script reload on a
**launched** Firefox by probing the tab that `extension dev --browser=firefox
--starting-url https://example.com` opened. In slow / headless environments the
extension add-on finishes installing **after** that tab finished loading, and a
declarative content script does **not** retroactively inject into an
already-loaded tab — so the gate's Step-1 "initial mount" probe sees nothing and
the whole serial test fails before it ever exercises reload.

This is an **at-launch injection race**, not a reload regression. Reload itself is
proven green (see "What already works"). The fix is almost certainly in the test
harness (open a fresh tab post-readiness, mirroring the Chromium gate), with an
optional product question about whether the launcher should reinject the
starting tab after the add-on is ready.

---

## Background (just enough architecture)

- Post-"Option B", **launched Firefox and `--no-browser` both reload through the
  control-bridge SW producer** (dev server → service worker →
  `chrome.scripting` re-injection). The Firefox RDP controller is
  logging/source-inspection only; it no longer drives reload.
- `firefox-content-reload` is the launched-Firefox sibling of the Chromium
  `content-reload` gate. It runs a 9-scenario JS+CSS sequence (mount → JS edit →
  revert → JS syntax-error recovery → CSS edit → CSS syntax-error recovery → CSS
  revert) by spawning real `extension dev --browser=firefox`, connecting to the
  RDP socket, and evaluating DOM/CSS over RDP `evaluateJSAsync`.

## Symptom

Running the gate headless:

```bash
cd _FUTURE/examples
EXTENSION_LOCAL_CLI_CJS=$PWD/../../programs/extension/dist/cli.cjs \
CONTENT_RELOAD_EXAMPLES=content \
EXTENSION_GECKO_BINARY="$HOME/Library/Caches/extension.js/browsers/firefox/firefox/mac_arm-stable_145.0.1/Firefox.app/Contents/MacOS/firefox" \
MOZ_HEADLESS=1 \
  npx playwright test --project=firefox-content-reload --timeout=200000 --retries=0
```

fails at:

```
template.firefox-content-reload.spec.ts:567  Step 1 — initial mount
  expect(probeContains(port, anchor)).toBe(true)
  Expected: true   Received: false
```

The dev server is fully healthy in the same run — `Started devtools server on N`
and `Firefox Add-on ready for development.` are both logged; RDP connects; the
add-on installs. The page just never shows the content script.

## Root cause

1. `extension dev --browser=firefox --starting-url https://example.com` launches
   Firefox, which opens `example.com`.
2. extension.js then installs the unpacked add-on over RDP
   (`installTemporaryAddon`). On a slow/headless host this completes **after**
   `example.com` has already reached `document_idle`.
3. A declarative content script (`run_at: document_idle`, the default) injects
   during page load. WebExtensions do **not** retroactively inject declarative
   content scripts into tabs that already finished loading before the add-on
   existed. So the at-launch tab has no content script.
4. The spec's Step 1 polls `probeContains(port, anchor)` against **that
   at-launch tab** (`template.firefox-content-reload.spec.ts:565-572`,
   comment: "the page that the dev process opened"). It never sees the anchor →
   fail.

### Why the Chromium gate doesn't hit this

`template.content-reload.spec.ts` does **not** probe the at-launch tab. After the
dev server is ready it opens a **fresh** tab via the CDP HTTP endpoint
(`openCdpTab(server.cdpPort, 'https://example.com/')`,
`template.content-reload.spec.ts:615`). A freshly-navigated tab injects the
content script normally, so there's no race. The two gates are asymmetric — only
Firefox relies on the starting tab.

### Why it usually passes in CI

Real CI runs with a display (or working headless GL) and is faster, so the
add-on install typically wins the race against the page load, or the page is
still loading when the add-on registers. The failure reproduces reliably only in
slow / degraded-graphics sandboxes. It is therefore **flaky**, not consistently
green, which is its own reason to fix.

## What already works (do NOT redo)

- **Firefox reload is proven green**, independent of this gate, via the
  self-launch harness `pnpm test:firefox-reload:rdp`
  (`_FUTURE/examples/scripts/verify-firefox-reload-rdp.mjs`): self-mount + JS
  in-place + JS revert + CSS in-place + CSS revert, in a real rendered Firefox
  tab. It avoids the race by reloading the tab **after** RDP-installing the
  add-on. Passes deterministically (run it to confirm the mechanism).
- **`-headless` launch fix** already landed (extension.js commit `27323ba8`):
  `extension dev --browser=firefox` now passes the explicit `-headless` flag when
  `MOZ_HEADLESS` is set (previously it only inherited the env, letting the SWGL
  compositor init first and crash on displayless hosts). Confirmed: Firefox now
  logs "You are running in headless mode."
- **Readiness-signal fix** already landed (examples commit `4f20bfd`):
  `waitForRdpReady` now also matches Firefox's own `Started devtools server on N`
  (not just extension.js's author-mode `Firefox debug port: N`), so the gate
  reaches Step 1 instead of timing out at readiness. This is what surfaced the
  injection race — before it, the gate failed earlier.
- The SW-producer reinject engine (the actual reload code for both browsers) is
  comprehensively unit-tested in
  `programs/develop/dev-server/control-bridge/__spec__/producer-runtime.spec.ts`
  (in-place reinject, new-tab dynamic re-registration, full reload,
  `chrome.scripting`-unavailable fallback).

## The actual task

Make `firefox-content-reload` reliably exercise reload without depending on the
at-launch injection race. Acceptance criteria:

- The gate passes deterministically headless in a slow sandbox (repro command
  above), not just in fast CI.
- It still asserts the real thing: a source edit re-injects into an
  **already-open** tab **in place** (no navigation between edit and assertion) —
  that's the whole point of the suite; don't reduce it to "open a fresh tab per
  edit," which trivially passes even if reload is broken.
- No weakening of the existing JS/CSS/syntax-error/recovery scenarios.

## Candidate approaches (in rough order of preference)

1. **Open a fresh tab post-readiness, then never navigate again (mirror
   Chromium).** In `beforeAll`/Step 1, after `waitForRdpReady`, open a new tab to
   `example.com` over RDP (`listTabs`/`addTab` + a `navigateTo`, or reuse the
   starting tab but issue one `location.reload()` first). The content script
   injects on that navigation; every subsequent edit must then land **in place**
   with no further navigation. This removes the race while preserving the
   in-place semantics. Lowest risk; aligns the two gates.
   - The self-launch harness already does exactly this (`tabEval('location.reload()')`
     once, then asserts in place) — copy that shape.

2. **Have the launcher reinject the starting tab after the add-on is ready
   (product change).** Question to answer first: when a user runs
   `extension dev --browser=firefox`, should their content script appear on the
   `--starting-url` page without a manual reload? If yes, after
   `installAddons`/RDP-ready the launcher could broadcast an initial
   content-scripts reinject (the SW producer already does open-tab
   `chrome.scripting` injection). Check Chromium parity — Chromium users may have
   the same gap, just untested because that spec opens its own tab. If this is
   desired DX, it also fixes the gate for free. Higher blast radius; needs a
   product decision.

3. **Both:** do (1) to de-flake the gate now, and file (2) as a product DX
   investigation if at-launch mount is deemed desirable.

Recommended: start with (1). Evaluate (2) separately as DX, not as a test fix.

## Key files & references

- Gate (probes at-launch tab): `_FUTURE/examples/examples/template.firefox-content-reload.spec.ts`
  - Step 1 mount probe: ~L565-572 · `probeContains`: ~L480 · `startDev`/readiness: ~L179-248
- Chromium reference (opens fresh tab): `_FUTURE/examples/examples/template.content-reload.spec.ts:353` (`openCdpTab`), used at ~L615
- Working self-launch reference: `_FUTURE/examples/scripts/verify-firefox-reload-rdp.mjs` (`pnpm test:firefox-reload:rdp`)
- Launcher: `programs/extension/browsers/run-firefox/firefox-launch/index.ts` (spawn + RDP setup), `setup-rdp-after-launch.ts`
- SW producer (reload engine): `programs/develop/dev-server/control-bridge/producer-runtime.ts`
- Project config / project list: `_FUTURE/examples/playwright.config.ts` (project `firefox-content-reload`)

## Reproduction & validation notes (read before you start)

- **Local CLI:** build first — `pnpm compile` (repo root) → `programs/extension/dist/cli.cjs`. Point `EXTENSION_LOCAL_CLI_CJS` at it so the gate exercises your changes.
- **Firefox binary:** this sandbox's system Firefox (Nightly/stable 147) crashes
  the SWGL compositor even headless; the extension.js-cached **stable 145.0.1**
  renders fine. Use `EXTENSION_GECKO_BINARY` to pin it (path in the repro
  command). The spec honors `EXTENSION_GECKO_BINARY` (added alongside `4f20bfd`).
- **Headless:** set `MOZ_HEADLESS=1`. The SWGL crash annotation
  ("RenderCompositorSWGL failed mapping default framebuffer") is **non-fatal** —
  Firefox still renders (the self-launch gate proves it). Don't chase it; it's a
  sandbox graphics artifact.
- **Scope:** `CONTENT_RELOAD_EXAMPLES=content` to run just the canonical example.
- **Hygiene:** the gate edits `examples/content/src/content/{scripts.js,styles.css}`
  and restores them in `afterAll`/`finally`. If a run is killed mid-edit, check
  `git -C _FUTURE/examples status` and restore. Kill stray browsers between runs:
  `pkill -f mac_arm-stable_145; pkill -f "cli.cjs dev"`.
- **Gate to clear when done:** the repro command passes deterministically (run it
  2-3×), `pnpm test:firefox-reload:rdp` still passes, and the Chromium gates
  (`--project=content-reload`, `--project=launched-content-reload`,
  `--project=no-browser-content-reload`) are unaffected.

## History (commits that led here)

- extension.js `27323ba8` — fix(firefox): pass `-headless` when MOZ_HEADLESS is set
- examples `4f20bfd` — test(firefox-content-reload): detect Firefox's own RDP-ready line
- examples `528b649` — test(firefox-reload): self-launch deterministic Firefox JS+CSS gate (+ `EXTENSION_GECKO_BINARY` on the launcher gate)
