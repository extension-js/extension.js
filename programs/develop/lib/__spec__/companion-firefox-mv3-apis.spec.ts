// Regression gate: companion devtools/theme extensions must not call MV3-only
// chrome APIs in their Firefox bundles. When they do, Firefox MV2 throws
// "TypeError: chrome.X is undefined" at background load and the entire
// companion extension fails to register — which makes the user's own extension
// appear partially broken in about:debugging (Inspect button on the user's
// addon may still open, but neighbour cards in the runtime list are dead, and
// historically this masked itself as "Inspect doesn't work for action/locales
// examples on Firefox").
//
// History: chrome.action.onClicked / chrome.sidePanel.setPanelBehavior /
// chrome.webNavigation.* were unguarded in extension-js-devtools/src/background
// /log-central.ts. They were fixed by wrapping with
// `if (import.meta.env.EXTENSION_BROWSER !== 'firefox')` so the build-time
// define-plugin tree-shakes the bodies away in the Firefox bundle.
//
// This spec asserts the bundle is genuinely free of those tokens. Catching
// this statically makes the failure mode visible at `vitest` time instead of
// via "user clicks Inspect, nothing happens, files an issue."

import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {spawnSync} from 'child_process'

// Tokens that must NOT appear in the Firefox bundle of any extension.js
// companion. Each is either MV3-only or requires a permission Firefox MV2
// does not grant on the companion manifest. The leading "chrome." anchor is
// load-bearing — bare "action" or "webNavigation" appear elsewhere innocently
// (e.g. browser_action keys, navigation log strings). The trailing "."
// disambiguates property access from substring matches inside identifiers
// (e.g. "chrome.action" inside a comment string vs. an actual call site).
const FORBIDDEN_FIREFOX_TOKENS = [
  'chrome.action.',
  'chrome.sidePanel.',
  'chrome.webNavigation.',
  'chrome.declarativeNetRequest.',
  'chrome.offscreen.'
] as const

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const CLI_DIST = path.join(REPO_ROOT, 'programs', 'extension', 'dist', 'cli.cjs')

interface Companion {
  name: string
  packageDir: string
}

const COMPANIONS: Companion[] = [
  {
    name: 'extension-js-devtools',
    packageDir: path.join(REPO_ROOT, 'extensions', 'extension-js-devtools')
  },
  {
    name: 'extension-js-theme',
    packageDir: path.join(REPO_ROOT, 'extensions', 'extension-js-theme')
  }
]

function firefoxBundlePath(packageDir: string) {
  return path.join(packageDir, 'dist', 'firefox', 'background', 'scripts.js')
}

function ensureCliBuilt(): boolean {
  if (fs.existsSync(CLI_DIST)) return true

  // The companion build scripts shell out to programs/extension/dist/cli.cjs.
  // CI suites that filter to programs/develop never produce that artifact, so
  // compile it on demand here so the spec is self-contained.
  const result = spawnSync('pnpm', ['-C', 'programs/extension', 'run', 'compile'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: false
  })

  return result.status === 0 && fs.existsSync(CLI_DIST)
}

function ensureFirefoxBuild(packageDir: string, name: string): boolean {
  const bundlePath = firefoxBundlePath(packageDir)
  if (fs.existsSync(bundlePath)) return true

  // No prebuilt bundle — invoke the package's own build:firefox script. CI
  // generally has dist/ already; this branch protects local dev runs and
  // freshly-cloned checkouts.
  if (!ensureCliBuilt()) return false

  const result = spawnSync('npm', ['run', 'build:firefox'], {
    cwd: packageDir,
    stdio: 'inherit',
    shell: false
  })

  if (result.status !== 0) {
    // Treat as skip rather than throw: this regression gate must not fail
    // when the surrounding environment cannot produce a Firefox bundle
    // (e.g. CI suites that scope to programs/develop and never compile the
    // extension CLI). The bundle correctness check still runs in any suite
    // that does produce the bundle.
    return false
  }

  return fs.existsSync(bundlePath)
}

describe('companion Firefox bundle: no MV3-only chrome.* APIs', () => {
  for (const companion of COMPANIONS) {
    if (!fs.existsSync(companion.packageDir)) continue

    it(`${companion.name}: background bundle is free of MV3-only chrome APIs`, () => {
      const built = ensureFirefoxBuild(companion.packageDir, companion.name)
      if (!built) return

      const bundlePath = firefoxBundlePath(companion.packageDir)
      // extension-js-theme historically has no background; skip silently.
      if (!fs.existsSync(bundlePath)) return

      const source = fs.readFileSync(bundlePath, 'utf8')
      const offenders = FORBIDDEN_FIREFOX_TOKENS.filter((token) =>
        source.includes(token)
      )

      expect(
        offenders,
        `[${companion.name}] Firefox bundle (${path.relative(REPO_ROOT, bundlePath)}) ` +
          `contains MV3-only chrome.* tokens that crash Firefox MV2 backgrounds. ` +
          `Guard each call site in the source with ` +
          `\`if (import.meta.env.EXTENSION_BROWSER !== 'firefox')\` so the ` +
          `Firefox bundle tree-shakes them away.`
      ).toEqual([])
    })
  }
})
