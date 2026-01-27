import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'

const originalResolve = (require as any).resolve

vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}))

vi.mock('../../webpack-lib/check-build-dependencies', () => ({
  findExtensionDevelopRoot: () => null
}))

describe('css-lib integrations', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(require as any).resolve = vi.fn(() => {
      throw new Error('resolve disabled for test')
    })
    delete (process as any).env.EXTENSION_AUTHOR_MODE
  })

  afterEach(() => {
    ;(require as any).resolve = originalResolve
  })

  it('installs optional tooling into extension-develop root', async () => {
    let resolvedRoot: string | undefined
    const isDevelopPackageJson = (p: string) =>
      p.endsWith(`${path.sep}programs${path.sep}develop${path.sep}package.json`)

    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => isDevelopPackageJson(p),
        readFileSync: (p: string) => {
          if (isDevelopPackageJson(p)) {
            resolvedRoot = path.dirname(p)
            return JSON.stringify({name: 'extension-develop'})
          }
          return actual.readFileSync(p)
        }
      }
    })

    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(execFileSync).toHaveBeenCalled()
    const call = execFileSync.mock.calls[0]
    expect(call?.[2]?.cwd).toBe(resolvedRoot)
  })

  it('fails with a clear error when root cannot be resolved', async () => {
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: actual.readFileSync
      }
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(execFileSync).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      'Failed to locate the extension-develop runtime'
    )
    errorSpy.mockRestore()
  })
})
