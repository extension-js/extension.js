import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const FORBIDDEN_FIREFOX_TOKENS = [
  'chrome.action.',
  'chrome.sidePanel.',
  'chrome.webNavigation.',
  'chrome.declarativeNetRequest.',
  'chrome.offscreen.'
] as const

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const CLI_DIST = path.join(
  REPO_ROOT,
  'programs',
  'extension',
  'dist',
  'cli.cjs'
)

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

  const result = spawnSync(
    'pnpm',
    ['-C', 'programs/extension', 'run', 'compile'],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: false
    }
  )

  return result.status === 0 && fs.existsSync(CLI_DIST)
}

function ensureFirefoxBuild(packageDir: string, name: string): boolean {
  const bundlePath = firefoxBundlePath(packageDir)
  if (fs.existsSync(bundlePath)) return true

  if (!ensureCliBuilt()) return false

  const result = spawnSync('npm', ['run', 'build:firefox'], {
    cwd: packageDir,
    stdio: 'inherit',
    shell: false
  })

  return result.status === 0
}

describe('companion Firefox bundle: no MV3-only chrome.* APIs', () => {
  for (const companion of COMPANIONS) {
    if (!fs.existsSync(companion.packageDir)) continue

    it(`${companion.name}: background bundle is free of MV3-only chrome APIs`, () => {
      const built = ensureFirefoxBuild(companion.packageDir, companion.name)
      // A failed build used to return early and pass, so a broken bundler
      // reported green here. A build that does not run is now a failure.
      expect(built, `${companion.name}: firefox build did not run`).toBe(true)

      const manifestPath = path.join(
        companion.packageDir,
        'dist',
        'firefox',
        'manifest.json'
      )
      expect(
        fs.existsSync(manifestPath),
        `${companion.name}: firefox build emitted nothing`
      ).toBe(true)

      // A theme ships no background script, so it has no bundle to scan.
      const bundlePath = firefoxBundlePath(companion.packageDir)
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
