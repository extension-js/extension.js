import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {isStaticTheme, isStaticThemeSource} from '../../../lib/manifest-utils'
import type {DevOptions, Manifest} from '../../../types'
import {ApplyDevDefaults} from '../steps/apply-dev-defaults'

const THEME: Manifest = {
  manifest_version: 2,
  name: 'theme',
  version: '1.0',
  theme: {images: {theme_frame: 'images/frame.png'}}
} as unknown as Manifest

describe('isStaticTheme (§82)', () => {
  it('accepts a manifest whose only feature is the theme', () => {
    expect(isStaticTheme(THEME)).toBe(true)
  })

  it('rejects a manifest with no theme at all', () => {
    expect(isStaticTheme({manifest_version: 3, name: 'x'} as Manifest)).toBe(
      false
    )
    expect(isStaticTheme(undefined)).toBe(false)
    expect(isStaticTheme(null)).toBe(false)
  })

  it('rejects a theme that also ships runtime code', () => {
    for (const key of [
      'background',
      'content_scripts',
      'action',
      'browser_action',
      'options_ui',
      'devtools_page',
      'web_accessible_resources'
    ]) {
      const hybrid = {...THEME, [key]: {}} as unknown as Manifest
      expect(isStaticTheme(hybrid), key).toBe(false)
    }
  })
})

describe('isStaticThemeSource (§82)', () => {
  let tmp: string
  const write = (manifest: unknown) => {
    const abs = path.join(tmp, 'manifest.json')
    fs.writeFileSync(abs, JSON.stringify(manifest))
    return abs
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'static-theme-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('reads the decision off the manifest on disk, per target', () => {
    const manifestPath = write(THEME)
    expect(isStaticThemeSource(manifestPath, 'chrome')).toBe(true)
    expect(isStaticThemeSource(manifestPath, 'firefox')).toBe(true)
  })

  it('resolves browser-prefixed disqualifiers for the target being built', () => {
    // The background is Gecko-only, so the same source is a theme on Chromium
    // and is not one on Firefox.
    const manifestPath = write({
      ...THEME,
      'firefox:background': {scripts: ['bg.js']}
    })
    expect(isStaticThemeSource(manifestPath, 'chrome')).toBe(true)
    expect(isStaticThemeSource(manifestPath, 'firefox')).toBe(false)
  })

  it('answers false rather than throwing on a missing or invalid manifest', () => {
    expect(isStaticThemeSource(path.join(tmp, 'nope.json'), 'firefox')).toBe(
      false
    )
    expect(isStaticThemeSource(undefined, 'firefox')).toBe(false)
  })
})

// Drives ApplyDevDefaults over a fake compilation and reports whether the
// manifest asset was rewritten with the dev instrumentation.
function runApplyDevDefaults(manifestPath: string, browser: string) {
  const original = fs.readFileSync(manifestPath, 'utf-8')
  let updated: string | undefined

  const compilation: any = {
    errors: [],
    warnings: [],
    modules: [],
    getAsset: (name: string) =>
      name === 'manifest.json' ? {source: {source: () => original}} : undefined,
    updateAsset: (_name: string, source: {source: () => string}) => {
      updated = source.source()
    },
    hooks: {processAssets: {tap: (_o: any, fn: () => void) => fn()}}
  }

  const compiler: any = {
    options: {mode: 'development', output: {path: path.dirname(manifestPath)}},
    hooks: {
      thisCompilation: {
        tap: (_name: string, fn: (c: any) => void) => fn(compilation)
      }
    }
  }

  new ApplyDevDefaults({
    manifestPath,
    browser: browser as DevOptions['browser']
  } as any).apply(compiler)

  return {updated, compilation}
}

describe('ApplyDevDefaults theme exemption, both targets (§82)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-dev-defaults-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const writeManifest = (manifest: unknown) => {
    const abs = path.join(tmp, 'manifest.json')
    fs.writeFileSync(abs, JSON.stringify(manifest))
    return abs
  }

  // Chromium already skipped a theme; Firefox did not. Pinning both keeps the
  // two dev targets from drifting on what a theme is again.
  for (const browser of ['chrome', 'firefox']) {
    it(`leaves a static theme untouched on ${browser}`, () => {
      const {updated} = runApplyDevDefaults(writeManifest(THEME), browser)
      expect(updated).toBeUndefined()
    })

    it(`still instruments a non-theme extension on ${browser}`, () => {
      const {updated} = runApplyDevDefaults(
        writeManifest({
          manifest_version: 3,
          name: 'x',
          version: '1.0',
          background: {service_worker: 'sw.js'}
        }),
        browser
      )
      const patched = JSON.parse(updated as string)
      expect(patched.permissions).toContain('storage')
      expect(patched.content_security_policy).toBeDefined()
    })
  }
})
