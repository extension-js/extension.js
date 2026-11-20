import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import {collectThemeArrayIssues} from '../manifest-lib/theme-values'
import {ValidateThemeArrays} from '../steps/validate-theme-values'

describe('collectThemeArrayIssues', () => {
  const themed = (theme: Record<string, unknown>) =>
    collectThemeArrayIssues({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme
    } as any)

  it('accepts the arrays and strings a Chromium build loads or translates', () => {
    expect(
      themed({
        colors: {
          a: [229, 57, 53],
          b: [0, 0, 0, 0.5],
          c: [0, 0, 0, 1],
          d: [0, 0, 0, 0],
          e: '#ff0000',
          f: '#000',
          g: 'rgb(1, 2, 3)',
          h: 'white',
          i: 'RebeccaPurple'
        },
        tints: {buttons: [0.5, -1, 0.5]}
      })
    ).toEqual([])
  })

  it.each([
    ['#00000080', '[0, 0, 0, 0.5]'],
    ['#0008', '[0, 0, 0, 0.53]'],
    ['rgba(255, 0, 0, 0.5)', '[255, 0, 0, 0.5]'],
    ['rgb(255, 0, 0, 1)', '[255, 0, 0, 1]'],
    ['transparent', '[0, 0, 0, 0]'],
    ['rgba(255, 0, 0, 2)', '[R, G, B]'],
    ['rgb(100%, 0%, 0%)', '[R, G, B]'],
    ['hsl(0, 100%, 50%)', '[R, G, B]'],
    ['notacolor', '[R, G, B]'],
    ['#00', '[R, G, B]'],
    [[40.5, 48, 72], '[R, G, B]'],
    [[300, 0, 0], '[R, G, B]'],
    [[-1, 0, 0], '[R, G, B]'],
    [[0, 0], '[R, G, B]'],
    [[0, 0, 0, 1, 5], '[R, G, B]'],
    [['a', 0, 0], '[R, G, B]'],
    [[0, 0, 0, 'x'], '[R, G, B, A]'],
    [[0, 0, 0, 2], '[R, G, B, A]'],
    [[0, 0, 0, -0.1], '[R, G, B, A]']
  ])('refuses %j and offers %s to write', (value, write) => {
    expect(themed({colors: {frame: value}})).toEqual([
      {field: 'theme.colors.frame', value: JSON.stringify(value), write}
    ])
  })

  it('refuses tints that are not three numbers', () => {
    for (const value of [[0.5, 0.5], ['a', 1, 1], '#fff', [1, 2, 3, 4]]) {
      expect(themed({tints: {buttons: value}})).toEqual([
        {
          field: 'theme.tints.buttons',
          value: JSON.stringify(value),
          write: '[H, S, L]'
        }
      ])
    }
  })

  it('reports every refused key in manifest order', () => {
    const issues = themed({
      colors: {frame: [40.5, 48, 72], ok: '#fff', toolbar: 'notacolor'},
      tints: {buttons: [1, 2]}
    })
    expect(issues.map((issue) => issue.field)).toEqual([
      'theme.colors.frame',
      'theme.colors.toolbar',
      'theme.tints.buttons'
    ])
  })

  it('stays silent without a theme', () => {
    expect(collectThemeArrayIssues({} as any)).toEqual([])
    expect(collectThemeArrayIssues(undefined)).toEqual([])
  })
})

describe('ValidateThemeArrays step', () => {
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
    // The step validates the manifest EmitManifest read, never the disk.
    setOriginalManifestContent(
      compilation,
      fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')
    )

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

    new ValidateThemeArrays({manifestPath, browser: 'chrome'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(1)
    expect(compilation.errors[0].name).toBe('ThemeArrayInvalid')
    const message = String(compilation.errors[0].message)
    expect(message).toContain(
      'theme.colors.toolbar [40.5,48,72], write [R, G, B]'
    )
  })

  it('raises one error that lists every refused key', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme: {
        colors: {frame: 'hsl(0, 100%, 50%)', toolbar: '#fff'},
        tints: {buttons: [1, 2]}
      }
    })
    const {compiler, compilation} = makeCompiler()

    new ValidateThemeArrays({manifestPath, browser: 'chrome'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(1)
    const message = String(compilation.errors[0].message)
    expect(message).toContain(
      'theme.colors.frame "hsl(0, 100%, 50%)", write [R, G, B]'
    )

    expect(message).toContain('theme.tints.buttons [1,2], write [H, S, L]')
    expect(message).not.toContain('theme.colors.toolbar')
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

    new ValidateThemeArrays({manifestPath, browser: 'chrome'} as any).apply(
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

    new ValidateThemeArrays({manifestPath, browser: 'firefox'} as any).apply(
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

    new ValidateThemeArrays({manifestPath, browser: 'safari'} as any).apply(
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

    new ValidateThemeArrays({manifestPath, browser: 'safari'} as any).apply(
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

    new ValidateThemeArrays({
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

    new ValidateThemeArrays({manifestPath, browser: 'chrome'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(1)
  })
})
