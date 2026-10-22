import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {toolsHasDependencyMock} = vi.hoisted(() => ({
  toolsHasDependencyMock: vi.fn(
    (_projectPath: string, _dependency: string) => false
  )
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')

  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '')
  }
})

vi.mock('../../lib/has-dependency', () => ({
  hasDependency: (...args: [string, string]) => toolsHasDependencyMock(...args)
}))

vi.mock('../../lib/messages', () => ({
  isUsingIntegration: (name: string) => `[using ${name}]`,
  youAreAllSet: (name: string) => `[ready ${name}]`,
  integrationInstalledSuccessfully: (name: string) => `[installed ${name}]`,
  failedToInstallIntegration: (name: string) => `[failed ${name}]`,
  installingRootDependencies: (name: string) => `[installing ${name}]`
}))

import {maybeUsePostCss} from '../css-tools/postcss'
import {getTailwindConfigFile} from '../css-tools/tailwind'

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

  it('tailwind config discovery returns first existing file', () => {
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      String(p).endsWith('tailwind.config.js')
    )

    expect(getTailwindConfigFile('/p')?.endsWith('tailwind.config.js')).toBe(
      true
    )
  })

  it('maybeUsePostCss returns empty object when not in use', async () => {
    expect(await maybeUsePostCss('/p', {mode: 'development'})).toEqual({})
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
    vi.resetModules()
    toolsHasDependencyMock.mockImplementation(
      (_p: string, dep: string) => dep === 'tailwindcss'
    )

    const {isUsingTailwind} = await import('../css-tools/tailwind')

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(isUsingTailwind('/p')).toBe(true)
    expect(isUsingTailwind('/p')).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
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
    expect(res.options?.postcssOptions?.config).toBe(
      path.join('/project', 'postcss.config.js')
    )

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
