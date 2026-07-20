import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SpecialFoldersPlugin} from '..'

const toPosix = (value: string) => value.replace(/\\/g, '/')

const FS = vi.hoisted(() => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn()
}))
vi.mock('fs', () => ({...FS}))

const copyApply = vi.fn()
let lastCopyOptions: any = null
vi.mock('@rspack/core', async () => {
  const actual = await vi.importActual<any>('@rspack/core')
  return {
    ...actual,
    rspack: {
      ...actual.rspack,
      CopyRspackPlugin: vi.fn().mockImplementation(function (
        this: any,
        options: any
      ) {
        lastCopyOptions = options
        this.apply = copyApply
      })
    }
  }
})

const warnApply = vi.fn()
vi.mock('../warn-upon-folder-changes', () => ({
  WarnUponFolderChanges: vi.fn().mockImplementation(function (this: any) {
    this.apply = warnApply
  })
}))

const createFakeCompiler = (
  mode: 'development' | 'production',
  withWatch = false
) => {
  const hooks: any = {
    thisCompilation: {
      tap: (_name: string, callback: (c: any) => void) => {
        const compilation: any = {
          errors: [],
          hooks: {
            processAssets: {
              tap: (_opts: any, fn: () => void) => fn()
            }
          },
          getAssets: () => [],
          getAsset: () => undefined,
          emitAsset: () => {},
          fileDependencies: new Set<string>(),
          compiler: {
            webpack: {WebpackError: class WebpackError extends Error {}}
          }
        }
        callback(compilation)
      }
    }
  }

  const compiler: any = {
    options: {
      mode,
      context: '/project',
      watchOptions: withWatch ? {} : undefined
    },
    hooks
  }
  return compiler
}

describe('SpecialFoldersPlugin (public copying and guards)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastCopyOptions = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('applies CopyRspackPlugin when public exists (excludes manifest.json)', async () => {
    ;(FS.existsSync as any).mockImplementation(
      (absPath: string) => toPosix(absPath) === '/project/public'
    )
    ;(FS.statSync as any).mockImplementation((_absPath: string) => ({
      isDirectory: () => true
    }))

    const compiler = createFakeCompiler('production')
    new SpecialFoldersPlugin({manifestPath: '/project/manifest.json'}).apply(
      compiler as any
    )

    expect(copyApply).toHaveBeenCalledTimes(1)
    expect(lastCopyOptions?.patterns?.[0]?.globOptions?.ignore).toContain(
      'manifest.json'
    )
  })

  it('emits an error when public/ contains manifest.json', async () => {
    ;(FS.existsSync as any).mockImplementation(
      (absPath: string) =>
        toPosix(absPath) === '/project/public' ||
        toPosix(absPath) === '/project/public/manifest.json'
    )
    ;(FS.statSync as any).mockImplementation((_absPath: string) => ({
      isDirectory: () => true
    }))

    const compiler = createFakeCompiler('production')
    let capturedErrors: any[] = []
    const originalTap = (compiler as any).hooks.thisCompilation.tap
    ;(compiler as any).hooks.thisCompilation.tap = (
      name: string,
      callback: (c: any) => void
    ) => {
      originalTap(name, (c: any) => {
        capturedErrors = c.errors
        callback(c)
      })
    }

    new SpecialFoldersPlugin({manifestPath: '/project/manifest.json'}).apply(
      compiler as any
    )
    expect(capturedErrors.length).toBeGreaterThan(0)
    expect(String(capturedErrors[0])).toMatch(
      /manifest\.json must not be placed under public\//i
    )
  })

  it('wires WarnUponFolderChanges in development when watchOptions present', async () => {
    ;(FS.existsSync as any).mockReturnValue(false)
    const compiler = createFakeCompiler('development', true)
    new SpecialFoldersPlugin({manifestPath: '/project/manifest.json'}).apply(
      compiler as any
    )
    expect(warnApply).toHaveBeenCalledTimes(1)
  })
})
