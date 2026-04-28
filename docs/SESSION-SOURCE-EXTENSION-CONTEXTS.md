# Session: `--source` reaching extension UI contexts

Future ticket. Captures the architectural analysis and phased implementation
plan from the 2026-04-13 session on extending `extension dev --source` beyond
regular web pages.

## Context

`extension dev --source <url>` today prints live HTML/DOM of a web page after
content scripts inject — a strong inner-loop tool for content-script work. It
does **not** reach any extension UI surface: popup, options, side panel,
devtools panel, background service worker, offscreen, newtab override.

This ticket scopes what it would take to close that gap and recommends a
staged delivery.

## Current reachability (as of 3.13.4)

| Context | Chromium (CDP) | Firefox (RDP) |
|---|---|---|
| Page / web content (https://, file://) | ✅ works | ✅ works |
| Options page | ❌ filtered out | ❌ no addon-page RDP actor |
| Side panel | ❌ filtered out | ❌ no addon-page RDP actor |
| Popup | ❌ ephemeral + filtered | ❌ no addon-page RDP actor |
| Devtools panel | ❌ actively excluded | ❌ skipped in logging contexts |
| Background service worker (MV3) | ❌ filter rejects `service_worker` | ❌ not exposed |
| Offscreen / newtab override | ❌ filtered out | ❌ no addon-page RDP actor |

## Hard gates in the current code

- **Chromium target filter:** `programs/extension/browsers/run-chromium/chromium-source-inspection/targets.ts:45-48` requires `targetType === 'page'`. Reinjection path at `cdp-extension-controller/index.ts:300,365` applies the same filter.
- **Chromium devtools exclusion:** `chromium-source-inspection/page.ts:14-16` selector excludes `[data-extension-root="extension-js-devtools"]`.
- **Firefox tab-only enumeration:** `run-firefox/firefox-source-inspection/remote-firefox/rdp-api.ts:159-172` (`listTabs`) returns browser tabs only; addon background/options/popup/devtools surfaces are not RDP actors in the current plumbing.
- **Capture pipeline is context-agnostic:** `chromium-source-inspection/page.ts:406-582` + `extract.ts:15-112` use `Runtime.evaluate` + `document.documentElement.outerHTML`. No dependency on target type. The pipeline itself would work on any attached CDP session.
- **Watch re-attach is URL-keyed:** `ensureTargetAndSession(cdpClient, url)` re-attaches by matching URL on each rebuild. Fine for stable URLs; breaks for ephemeral popups.

## Feasibility by context

### Chromium

| Context | Effort | Reason |
|---|---|---|
| Options page | Low | Stable `chrome-extension://<id>/options.html`. Filter widening + URL routing only. |
| Side panel | Low | Same shape as options. |
| Newtab override | Low | Stable `chrome://newtab/` or extension URL. |
| Devtools panel | Medium | Stable URL, but selector exclusion must be reversed and devtools target attach is a different CDP flow. |
| Background service worker (MV3) | Medium | Already attach to `service_worker` targets in `cdp-extension-controller/derive-id.ts:176-198`. But output shape is **not HTML** — needs console tail + storage dump. Ship as a distinct `--source-context background` mode. |
| Popup | Medium (as tab-mode proxy) or Structural (real popup) | See below. |

### Firefox

| Context | Effort | Reason |
|---|---|---|
| Any extension UI | Structural | RDP actors for addon pages/background aren't wired. Would require new RDP plumbing against actor descriptors that are currently unused in this codebase. |

## Popup: tab-mode is the pragmatic answer

Ephemeral popup lifecycle (closes on blur) breaks watch re-attach. The same
context served as a fresh tab at `chrome-extension://<id>/popup.html` is a
near-perfect proxy because popup content is just a regular HTML document.

**What tab mode preserves:**
- DOM, CSS, JS execution — identical document
- Stable URL for watch re-attach
- All `--source-*` sub-flags work unchanged

**What tab mode diverges on (must be in the warning banner):**
- Viewport: popups auto-size ≤ ~800×600; tabs are full width. Layout differs.
- `window.close()` closes the tab instead of dismissing a popup.
- `chrome.action` state the popup expects at open-time (`setPopup`, `setBadgeText` read paths).
- Popup-lifecycle message ports (port-closes-on-popup-close pattern) don't close on blur in a tab.
- User-gesture inheritance from the icon click — some APIs gated on it behave differently.
- `window` focus/blur semantics — blur in a tab doesn't mean "user dismissed me."

Name it honestly: `--source-context popup` in tab mode, with a one-line header
in the output: *"popup rendered in tab mode — viewport and action-lifecycle
APIs may differ from real popup"*.

Real-popup support (pin-open via devtools attach) can be a later Phase C
behind `--source-context popup --pin`.

## Proposed phasing

### Phase A — static extension views on Chromium (~1 week)

**Flag:** `--source-context <page|options|sidepanel|devtools|newtab|popup>`
(default `page` — backwards compatible)

**Scope:**
- Add `sourceContext` to `DevOptions` in `programs/extension/commands/dev.ts:39-72`
- Thread through `BrowserLaunchOptions` in `programs/extension/browsers/index.ts`
- Resolve context → URL in the launch layer: `options` → `chrome-extension://<id>/options.html` (id from `cdp-extension-controller/derive-id.ts`), etc.
- Loosen filter in `chromium-source-inspection/targets.ts:48` to accept `'other'` for `chrome-extension://` targets
- Remove devtools exclusion in `page.ts:14-16` when context === devtools
- `popup` context routes to tab mode with the divergence banner
- Update `programs/extension/index.ts` guard to allow `--source-context` alongside `--source`

**Tests (parity with existing contracts):**
- `browsers/__spec__/launch-browser.chromium-source-context.unit.spec.ts` — forwarding for each context value
- `__spec__/exec/help-parity.contract.spec.ts` — new contract: `--source-context` listed, enum values, default
- Fixture extension + integration: open options page via `--source-context options`, assert HTML extracted
- Popup tab-mode banner present in output

**Out of scope:** background, Firefox, popup-pin.

### Phase B — background service worker probe (~1 week, distinct feature)

**Flag:** `--source-context background`

Not HTML. Different output shape:
- Console tail (already available via unified logger — reuse `enableUnifiedLogging` contexts filter)
- `self.registration` state dump
- `chrome.storage.local` / `chrome.storage.session` contents snapshot
- Live updates on `--watch-source`

Advertise as its own capability; avoid conflating with HTML inspection in docs.

### Phase C — real popup via pin-open (only if demand)

Use CDP `Target.autoAttach` + devtools-attached pin trick to keep popup from
closing on blur. Gate behind `--source-context popup --pin`.

### Phase D — Firefox parity (only if demand)

New RDP plumbing against addon-page actor descriptors. Not started; would be
its own multi-week effort.

## Rejection matrix

The `--source-context` flag combines with existing ones as follows:

| Combination | Behavior |
|---|---|
| `--source-context <any>` + `--wait` | Reject (already guarded) |
| `--source-context <any>` + `--no-browser` | Reject (already guarded) |
| `--source-context background` + `--source-dom` | Reject (no DOM in SW) |
| `--source-context background` + `--source-include-shadow` | Reject (no DOM) |
| `--source-context background` + `--source-probe` | Reject (no DOM) |
| `--source-context popup` (tab mode) | Print banner about viewport/API divergence |
| `--source-context <ext-view>` on `firefox` | Reject until Phase D |

## Success criteria

- `extension dev --source-context options` prints live HTML of the options page and re-prints on rebuild
- Every new combination has an explicit contract test in `help-parity.contract.spec.ts`
- `extension --ai-help` advertises the new capability with the same candor as the existing source-inspection section
- No regressions in the existing `--source <url>` path

## Pointers for the implementer

- Extension ID derivation: `programs/extension/browsers/run-chromium/chromium-source-inspection/cdp-extension-controller/derive-id.ts` (already attaches to `service_worker`, useful reference for Phase B)
- Target attach flow: `chromium-source-inspection/targets.ts:31-126` (`ensureTargetAndSession`)
- Capture pipeline: `chromium-source-inspection/page.ts:406-582`, `extract.ts:15-112`
- Watch loop: `chromium-source-inspection/deterministic-hmr-harness.ts:92-121` and `ChromiumSourceInspectionPlugin`
- Existing guard pattern: `programs/extension/index.ts:76-176` (`guardSourceInspectionFlags`, `guardSourceWithWaitOrNoBrowser`) and `programs/extension/helpers/messages.ts:548-605`
- Contract test pattern: `programs/extension/__spec__/exec/help-parity.contract.spec.ts` (contracts #6b, #6c, #13, #14)

## Related shipped work (same session)

Context for why this ticket exists — the following landed first and set the
guard/contract pattern this ticket should extend:

- Forward all `--source-*` and `--log-*` options into Firefox (previously silently dropped)
- Strip `--source-*` declarations from `start` / `preview` + pre-parse rejection guard
- Convert canonical content-script entries → `ContentScriptTargetRule[]` before reload (Chromium + Firefox)
- Remove ceremonial `close()` from `BrowserController` (signal handlers own teardown)
- Guard `dev --source` + `--wait` rejection
- Guard `dev --source` + `--no-browser` rejection
- Contract tests #13 and #14 for the new guards
