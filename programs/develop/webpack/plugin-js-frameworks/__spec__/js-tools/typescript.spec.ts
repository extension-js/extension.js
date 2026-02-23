import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'

const toPosix = (value: string) => value.replace(/\\/g, '/')

vi.mock('../../frameworks-lib/integrations', () => ({
  isUsingJSFramework: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true),
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

  it('isUsingTypeScript throws when TS files present but no tsconfig next to package.json', async () => {
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

    const {isUsingTypeScript} = await import('../../js-tools/typescript')

    // No tsconfig present, but TS files exist -> hard error, no writes
    expect(() => isUsingTypeScript('/project')).toThrowError(
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
})
