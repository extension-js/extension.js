import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '')
  }
})

vi.mock('../css-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

vi.mock('../../webpack-lib/messages', () => ({
  isUsingIntegration: (name: string) => `[using ${name}]`,
  youAreAllSet: (name: string) => `[ready ${name}]`,
  integrationInstalledSuccessfully: (name: string) => `[installed ${name}]`,
  failedToInstallIntegration: (name: string) => `[failed ${name}]`,
  installingRootDependencies: (name: string) => `[installing ${name}]`
}))

// Load after mocks
import {isUsingSass, maybeUseSass} from '../css-tools/sass'
import {isUsingLess, maybeUseLess} from '../css-tools/less'
import {isUsingPostCss, maybeUsePostCss} from '../css-tools/postcss'
import {isUsingStylelint, getStylelintConfigFile} from '../css-tools/stylelint'
import {isUsingTailwind, getTailwindConfigFile} from '../css-tools/tailwind'

const originalRequireResolve = (require as any).resolve

describe('css tools detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'false'
  })

  afterEach(() => {
    ;(fs.readFileSync as any).mockReset?.()
    ;(fs.existsSync as any).mockReset?.()
    ;(require as any).resolve = originalRequireResolve
  })

  it('stylelint config discovery returns undefined when files are missing', () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    expect(getStylelintConfigFile('/p')).toBeUndefined()
  })

  it('tailwind config discovery returns first existing file', () => {
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      String(p).endsWith('tailwind.config.js')
    )
    expect(getTailwindConfigFile('/p')?.endsWith('tailwind.config.js')).toBe(
      true
    )
  })

  it('isUsingStylelint returns false without package.json', () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    expect(isUsingStylelint('/p')).toBe(false)
  })

  it('maybeUsePostCss returns empty object when not in use', async () => {
    expect(await maybeUsePostCss('/p', {mode: 'development'})).toEqual({})
  })
})

describe('isContentScriptEntry', () => {
  it('returns true if issuer matches content script in manifest', async () => {
    const manifest = {
      content_scripts: [{js: ['content.js']}]
    }
    ;(fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(manifest))
    // Ensure manifest path existence check passes
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      String(p).endsWith('manifest.json')
    )
    const {isContentScriptEntry} = (await import(
      '../css-lib/is-content-script'
    )) as any
    const path = require('path')
    const issuer = path.resolve('/project', 'content.js')
    const manifestPath = path.join('/project', 'manifest.json')
    expect(isContentScriptEntry(issuer, manifestPath, '/project')).toBe(true)
  })

  it('returns false for non-matching paths', async () => {
    const manifest = {content_scripts: [{js: ['a.js']}]} as any
    ;(fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(manifest))
    const {isContentScriptEntry} = (await import(
      '../css-lib/is-content-script'
    )) as any
    expect(isContentScriptEntry('/x/b.js', '/x/manifest.json', '/x')).toBe(
      false
    )
  })
})

describe('css tools additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(fs.existsSync as any).mockReset?.()
    ;(fs.readFileSync as any).mockReset?.()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  afterEach(() => {
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'false'
  })

  it('isUsingTailwind logs only once across multiple calls', async () => {
    // Work with the mocked module (declared above) so the implementation used by code under test is affected.
    const mockedIntegrations = (await import(
      '../css-lib/integrations'
    )) as unknown as {
      hasDependency: any
    }
    mockedIntegrations.hasDependency.mockImplementation(
      (_: any, dep: string) => dep === 'tailwindcss'
    )

    const {isUsingTailwind} = await import('../css-tools/tailwind')

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(isUsingTailwind('/p')).toBe(true)
    // Second call should not re-log
    expect(isUsingTailwind('/p')).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('isContentScriptEntry returns false for empty inputs (early return)', async () => {
    const {isContentScriptEntry} = await import('../css-lib/is-content-script')
    expect(isContentScriptEntry('', '', '')).toBe(false)
    expect(isContentScriptEntry('/x', '', '')).toBe(false)
    expect(isContentScriptEntry('', '/x/manifest.json', '')).toBe(false)
  })

  it('maybeUsePostCss returns loader config when a PostCSS config file exists', async () => {
    vi.doMock('../css-tools/tailwind', () => ({isUsingTailwind: () => false}))
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      String(p).endsWith('postcss.config.js')
    )

    const {maybeUsePostCss} = await import('../css-tools/postcss')
    const res = await maybeUsePostCss('/project', {mode: 'development'})
    expect(res.loader).toBeDefined()
    expect(String(res.loader)).toContain('postcss-loader')
    // Since the test doesn't provide a real config module to load,
    // we fall back to discovery from the project root
    expect(res.options?.postcssOptions?.config).toBe('/project')
    expect(res.options?.postcssOptions?.plugins).toBeUndefined()
  })

  it('maybeUsePostCss never exits process while configuring PostCSS', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      String(p).endsWith('postcss.config.js')
    )

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      _code?: string | number | null | undefined
    ) => {
      throw new Error('process.exit should not be called')
    }) as any)

    const res = await maybeUsePostCss('/project', {mode: 'production'})

    expect(String(res.loader)).toContain('postcss-loader')
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
