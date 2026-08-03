import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {collectThemeValueIssues} from '../manifest-lib/theme-values'
import {ValidateThemeValues} from '../steps/validate-theme-values'

describe('collectThemeValueIssues', () => {
  const themed = (theme: Record<string, unknown>) =>
    collectThemeValueIssues({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme
    } as any)

  it('accepts integer RGB arrays', () => {
    expect(themed({colors: {toolbar: [229, 57, 53]}})).toEqual([])
  })

  it('accepts RGBA with a float alpha, which Chrome allows', () => {
    expect(themed({colors: {frame: [0, 0, 0, 0.5]}})).toEqual([])
  })

  it('accepts RGBA with an integer alpha', () => {
    expect(themed({colors: {frame: [0, 0, 0, 1]}})).toEqual([])
  })

  it('rejects non-integer color channels', () => {
    const issues = themed({colors: {toolbar: [40.5, 48, 72]}})
    expect(issues).toHaveLength(1)
    expect(issues[0].field).toBe('theme.colors.toolbar')
    expect(issues[0].detail).toMatch(/integer/i)
  })

  it('rejects channels outside 0-255', () => {
    expect(themed({colors: {frame: [300, 0, 0]}})).toHaveLength(1)
    expect(themed({colors: {frame: [-1, 0, 0]}})).toHaveLength(1)
  })

  it('rejects arrays that are not length 3 or 4', () => {
    expect(themed({colors: {frame: [0, 0]}})).toHaveLength(1)
    expect(themed({colors: {frame: [0, 0, 0, 1, 5]}})).toHaveLength(1)
  })

  it('rejects non-array and non-numeric values', () => {
    expect(themed({colors: {frame: 'red'}})).toHaveLength(1)
    expect(themed({colors: {frame: 'rgb(0, 0, 0)'}})).toHaveLength(1)
    expect(themed({colors: {frame: ['a', 0, 0]}})).toHaveLength(1)
    expect(themed({colors: {frame: [0, 0, 0, 'x']}})).toHaveLength(1)
  })

  it('accepts hex strings, which the chromium writer converts to arrays', () => {
    expect(themed({colors: {frame: '#ff0000'}})).toEqual([])
    expect(themed({colors: {tab_text: '#000'}})).toEqual([])
    expect(themed({colors: {frame: '#00000080'}})).toEqual([])
    expect(themed({colors: {frame: '#0008'}})).toEqual([])
  })

  it('still rejects malformed hex-like strings', () => {
    expect(themed({colors: {frame: '#00'}})).toHaveLength(1)
    expect(themed({colors: {frame: '#ggg'}})).toHaveLength(1)
    expect(themed({colors: {frame: '000000'}})).toHaveLength(1)
  })

  it('accepts tints of 3 numbers and rejects other tint shapes', () => {
    expect(themed({tints: {buttons: [0.5, 0.5, 0.5]}})).toEqual([])
    expect(themed({tints: {buttons: [0.5, 0.5]}})).toHaveLength(1)
    expect(themed({tints: {buttons: ['a', 1, 1]}})).toHaveLength(1)
  })

  it('reports every malformed key', () => {
    const issues = themed({
      colors: {frame: [40.5, 48, 72], toolbar: 'red'},
      tints: {buttons: [1, 2]}
    })
    expect(issues.map((issue) => issue.field)).toEqual([
      'theme.colors.frame',
      'theme.colors.toolbar',
      'theme.tints.buttons'
    ])
  })

  it('stays silent without a theme', () => {
    expect(collectThemeValueIssues({} as any)).toEqual([])
    expect(collectThemeValueIssues(undefined)).toEqual([])
  })
})

describe('ValidateThemeValues step', () => {
  let tmp = ''

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-values-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeCompiler = () => {
    const compilation: any = {
      hooks: {processAssets: {tap: (_: any, cb: () => void) => cb()}},
      errors: [],
      warnings: []
    }
    const compiler: any = {
      hooks: {
        thisCompilation: {
          tap: (_: string, cb: (c: any) => void) => cb(compilation)
        }
      },
      rspack: {WebpackError: Error}
    }
    return {compiler, compilation}
  }

  const writeManifest = (manifest: Record<string, unknown>) => {
    const manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    return manifestPath
  }

  it('fails the chromium build for malformed theme colors', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme: {colors: {toolbar: [40.5, 48, 72]}}
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeValues({manifestPath, browser: 'chrome'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(1)
    const message = String(compilation.errors[0])
    expect(message).toContain('theme.colors.toolbar')
    expect(message).toMatch(/INVALID VALUE/)
    expect(message).toContain('[40.5,48,72]')
  })

  it('passes a valid theme untouched', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme: {
        colors: {frame: [0, 0, 0], toolbar: [255, 255, 255, 0.9]},
        tints: {buttons: [0.3, 0.5, 0.5]}
      }
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeValues({manifestPath, browser: 'chrome'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(0)
  })

  it('skips non-chromium targets, Firefox accepts other color shapes', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'x',
      version: '1.0.0',
      theme: {colors: {frame: '#ff0000'}}
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeValues({manifestPath, browser: 'firefox'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(0)
  })

  // Safari has no theme surface. The skip must be spoken, not silent, and it
  // must never fail the build the way malformed chromium values do.
  it('warns once for a themed manifest on safari instead of skipping silently', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme: {colors: {toolbar: [40.5, 48, 72]}}
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeValues({manifestPath, browser: 'safari'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(0)
    expect(compilation.warnings).toHaveLength(1)
    const message = String(compilation.warnings[0])
    expect(message).toContain('theme')
    expect(message).toContain('safari')
  })

  it('stays silent on safari when the manifest has no theme', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0'
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeValues({manifestPath, browser: 'safari'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(0)
    expect(compilation.warnings).toHaveLength(0)
  })

  it('warns for webkit-based targets too', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme: {colors: {toolbar: [0, 0, 0]}}
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeValues({
      manifestPath,
      browser: 'webkit-based'
    } as any).apply(compiler)

    expect(compilation.errors).toHaveLength(0)
    expect(compilation.warnings).toHaveLength(1)
  })

  it('honors browser-prefixed theme keys', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      'chromium:theme': {colors: {frame: [999, 0, 0]}}
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeValues({manifestPath, browser: 'chrome'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(1)
  })
})
