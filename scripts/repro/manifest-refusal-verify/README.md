# Manifest-refusal live verification harness

Every refusal shape in `programs/extension/browsers/browsers-lib/manifest-refusal.ts`
and every repair in `feature-manifest/manifest-lib/sanitize-fatal-shapes.ts` must be
verified against a REAL browser before it lands — this family has produced six false
positives (explicit ports, wildcard ports, query/fragments on Chrome; ports again on
Firefox; MV3 background.page/persistent; undecodable icon bytes) where the docs said
"refuses" and the browser said "loads".

## Chrome (CDP Extensions.loadUnpacked — reports the refusal reason)

```bash
node make-fixtures.mjs    # batch 1: candidate shapes + negative controls
node make-fixtures2.mjs   # batch 2: grammar edge cases
CHROME_BIN="$HOME/.cache/puppeteer/chrome/mac_arm-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  node verify-chrome.mjs  # point fixturesRoot at fixtures/ or fixtures2/
```

## Firefox (RDP installTemporaryAddon — refusal reason comes back in-protocol)

```bash
FIREFOX_BIN="/Applications/Firefox.app/Contents/MacOS/firefox" node verify-firefox.mjs
```

Last full run: 2026-07-13 on Chrome for Testing 150.0.7871.24 and Firefox 147.0.3.
Outcomes (exact error strings included) are encoded as comments and specs next to
each check; `SURPRISE` rows in the output are shapes whose expectation was wrong —
those become temptation-list entries, never checks.

To verify a NEW candidate shape: add a fixture with `expect: 'refuse'` plus a
loading negative control, run the verifier, and only implement the check if the
outcome is `REFUSED as-expected` on a current stable browser.
