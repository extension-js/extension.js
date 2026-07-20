import * as fs from 'fs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const toPosix = (value: string) => value.replace(/\\/g, '/')

vi.mock('../../frameworks-lib/integrations', () => ({
  isUsingJSFramework: vi.fn(() => false),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    readdirSync: vi.fn(() => []),
    writeFileSync: vi.fn(() => undefined)
  }
})

describe('typescript tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })
  afterEach(() => {
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'false'
  })

  it('getUserTypeScriptConfigFile finds tsconfig.json next to package.json only', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      const s = toPosix(String(p))
      if (s.endsWith('/project/package.json')) return true
      if (s.endsWith('/project/tsconfig.json')) return true
      return false
    })
    const {getUserTypeScriptConfigFile} = await import(
      '../../js-tools/typescript'
    )

    expect(toPosix(getUserTypeScriptConfigFile('/project') || '')).toBe(
      '/project/tsconfig.json'
    )
  })

  it('ensureTypeScriptConfig throws when TS files present but no tsconfig next to package.json', async () => {
    // Package.json in /project (stop search early)
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      toPosix(String(p)).endsWith('/project/package.json') ? true : false
    )
    ;(fs.readFileSync as any).mockImplementation((p: string) => {
      if (toPosix(String(p)).endsWith('package.json')) {
        return JSON.stringify({dependencies: {}})
      }
      return ''
    })
    ;(fs.readdirSync as any).mockImplementation((_p: string, _o: any) => [
      {isFile: () => true, isDirectory: () => false, name: 'file.ts'}
    ])

    const {ensureTypeScriptConfig, isUsingTypeScript} = await import(
      '../../js-tools/typescript'
    )

    // Detection itself is side-effect-free and just returns false here.
    expect(isUsingTypeScript('/project')).toBe(false)

    // No tsconfig present, but TS files exist -> hard error, no writes
    expect(() => ensureTypeScriptConfig('/project')).toThrowError(
      /Missing tsconfig\.json next to package\.json/
    )
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('maybeUseTypeScript returns true when tsconfig exists and typescript resolves', async () => {
    // Make tsconfig exist
    ;(fs.existsSync as any).mockImplementation(
      (p: string) =>
        toPosix(String(p)).endsWith('/project/tsconfig.json') ||
        toPosix(String(p)).endsWith('/project/package.json')
    )
    ;(fs.readFileSync as any).mockImplementation((p: string) => {
      if (toPosix(String(p)).endsWith('package.json')) {
        return JSON.stringify({devDependencies: {typescript: '^5'}})
      }
      return ''
    })

    // Make require.resolve('typescript') succeed
    const originalResolve = (require as any).resolve
    ;(require as any).resolve = vi.fn((id: string) =>
      id === 'typescript' ? '/mock/typescript' : originalResolve(id)
    )

    const {maybeUseTypeScript} = await import('../../js-tools/typescript')
    const result = await maybeUseTypeScript('/project')
    expect(result).toBe(true)
    ;(require as any).resolve = originalResolve
  })

  it('maybeUseTypeScript succeeds when the project does NOT declare typescript', async () => {
    // The 12.4% shape from the real-world corpus (112 of 902 TypeScript
    // projects): tsconfig.json + .ts sources, but no `typescript` dependency.
    // extension-develop no longer ships its own copy, and nothing in the build
    // needs one (sources are compiled by swc), so this must resolve rather
    // than throw an "install typescript" error the way the old optional-dep
    // contract would have.
    ;(fs.existsSync as any).mockImplementation(
      (p: string) =>
        toPosix(String(p)).endsWith('/project/tsconfig.json') ||
        toPosix(String(p)).endsWith('/project/package.json')
    )
    ;(fs.readFileSync as any).mockImplementation((p: string) => {
      if (toPosix(String(p)).endsWith('package.json')) {
        // No typescript in either dependency block.
        return JSON.stringify({dependencies: {}, devDependencies: {}})
      }
      return ''
    })
    ;(fs.readdirSync as any).mockImplementation(() => [
      {name: 'index.ts', isFile: () => true, isDirectory: () => false}
    ])

    const {maybeUseTypeScript} = await import('../../js-tools/typescript')
    await expect(maybeUseTypeScript('/project')).resolves.toBe(true)
  })

  it('getTypeScriptConfigOverrides toggles sourceMap by mode', async () => {
    const {getTypeScriptConfigOverrides} = await import(
      '../../js-tools/typescript'
    )
    expect(
      getTypeScriptConfigOverrides({mode: 'development'}).compilerOptions
        .sourceMap
    ).toBe(true)
    expect(
      getTypeScriptConfigOverrides({mode: 'production'}).compilerOptions
        .sourceMap
    ).toBe(false)
  })

  it('defaultTypeScriptConfig scaffolds a moduleResolution TypeScript 7 accepts', async () => {
    const {defaultTypeScriptConfig} = await import('../../js-tools/typescript')
    const {compilerOptions} = defaultTypeScriptConfig('/project')
    // 'node' (node10) was REMOVED in TypeScript 7: scaffolding it made the
    // generated tsconfig fail the user's own `tsc --noEmit` with TS5108.
    expect(compilerOptions.moduleResolution).toBe('bundler')
    // 'bundler' is only valid alongside a modern module setting.
    expect(compilerOptions.module).toBe('esnext')
  })
})
