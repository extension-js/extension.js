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
    // Full path, not a bare filename: the copy glob matches full paths, so
    // only the root public/manifest.json is excluded and nested ones copy.
    expect(lastCopyOptions?.patterns?.[0]?.globOptions?.ignore).toContain(
      '/project/public/manifest.json'
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
  it('copies from the folder beside the manifest and notes the placement', () => {
    ;(FS.existsSync as any).mockImplementation(
      (absPath: string) => toPosix(absPath) === '/project/src/public'
    )
    ;(FS.statSync as any).mockImplementation((_absPath: string) => ({
      isDirectory: () => true
    }))
    const warnings: any[] = []
    const compiler = createFakeCompiler('production')
    const originalTap = compiler.hooks.thisCompilation.tap
    compiler.hooks.thisCompilation.tap = (
      name: string,
      callback: (c: any) => void
    ) =>
      originalTap(name, (compilation: any) => {
        compilation.warnings = warnings
        callback(compilation)
      })

    new SpecialFoldersPlugin({
      manifestPath: '/project/src/manifest.json'
    }).apply(compiler as any)

    expect(copyApply).toHaveBeenCalled()
    expect(toPosix(lastCopyOptions.patterns[0].from)).toBe(
      '/project/src/public'
    )
    expect(warnings.map((w) => w.name)).toContain('PublicLayoutWarning')
    expect(String(warnings[0].message)).toContain('/project/src/public')
    expect(String(warnings[0].message)).toContain('/project/public')
  })

  it('names the winner when both folders exist', () => {
    ;(FS.existsSync as any).mockImplementation((absPath: string) =>
      ['/project/public', '/project/src/public'].includes(toPosix(absPath))
    )
    ;(FS.statSync as any).mockImplementation((_absPath: string) => ({
      isDirectory: () => true
    }))
    const warnings: any[] = []
    const compiler = createFakeCompiler('production')
    const originalTap = compiler.hooks.thisCompilation.tap
    compiler.hooks.thisCompilation.tap = (
      name: string,
      callback: (c: any) => void
    ) =>
      originalTap(name, (compilation: any) => {
        compilation.warnings = warnings
        callback(compilation)
      })

    new SpecialFoldersPlugin({
      manifestPath: '/project/src/manifest.json'
    }).apply(compiler as any)

    expect(toPosix(lastCopyOptions.patterns[0].from)).toBe('/project/public')
    const shadowed = warnings.find(
      (w) => w.name === 'PublicFolderShadowedWarning'
    )
    expect(shadowed).toBeDefined()
    expect(String(shadowed.message)).toContain('USING /project/public')
    expect(String(shadowed.message)).toContain('IGNORED /project/src/public')
  })
})
