import * as fs from 'node:fs'
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

  it('getUserTypeScriptConfigFile finds tsconfig.json next to package.json', async () => {
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

  // Regression: a manifest-only project has no package.json to sit beside, so
  // the lookup found nothing while writeTsConfig had already scaffolded at the
  // project root. TypeScript detection stayed false and every .ts source hit
  // the JS parser as 'const declarations must be initialized'.
  it('getUserTypeScriptConfigFile finds a project-root tsconfig with no package.json', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      toPosix(String(p)).endsWith('/project/tsconfig.json')
    )
    const {getUserTypeScriptConfigFile} = await import(
      '../../js-tools/typescript'
    )

    expect(toPosix(getUserTypeScriptConfigFile('/project') || '')).toBe(
      '/project/tsconfig.json'
    )
  })

  it('sees TypeScript in a manifest-only project once the scaffold is written', async () => {
    const present = new Set<string>()
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      present.has(toPosix(String(p)))
    )
    ;(fs.readFileSync as any).mockImplementation(() => '')
    ;(fs.readdirSync as any).mockImplementation(() => [
      {isFile: () => true, isDirectory: () => false, name: 'scripts.ts'}
    ])
    ;(fs.writeFileSync as any).mockImplementation((p: string) => {
      present.add(toPosix(String(p)))
    })

    const {ensureTypeScriptConfig, isUsingTypeScript} = await import(
      '../../js-tools/typescript'
    )

    expect(isUsingTypeScript('/project')).toBe(false)

    ensureTypeScriptConfig('/project')

    const [writtenPath] = (fs.writeFileSync as any).mock.calls[0]
    expect(toPosix(String(writtenPath))).toBe('/project/tsconfig.json')
    expect(isUsingTypeScript('/project')).toBe(true)
  })

  it('ensureTypeScriptConfig scaffolds the default tsconfig when TS files are present without one', async () => {
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

    expect(isUsingTypeScript('/project')).toBe(false)

    expect(() => ensureTypeScriptConfig('/project')).not.toThrow()
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    const [writtenPath, written] = (fs.writeFileSync as any).mock.calls[0]
    expect(toPosix(String(writtenPath))).toBe('/project/tsconfig.json')
    expect(JSON.parse(String(written)).compilerOptions).toBeTruthy()
  })

  it('scaffolds beside the nearest package.json for src/-layout projects', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      toPosix(String(p)).endsWith('/project/package.json')
    )
    ;(fs.readFileSync as any).mockImplementation(() => '')
    ;(fs.readdirSync as any).mockImplementation((p: string) => {
      if (toPosix(String(p)).endsWith('/project/src')) {
        return [{isFile: () => true, isDirectory: () => false, name: 'app.ts'}]
      }
      return []
    })

    const {ensureTypeScriptConfig} = await import('../../js-tools/typescript')
    ensureTypeScriptConfig('/project/src')

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    const [writtenPath] = (fs.writeFileSync as any).mock.calls[0]
    expect(toPosix(String(writtenPath))).toBe('/project/tsconfig.json')
  })

  it('detects TS sources in surface folders beyond the old allowlist', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      toPosix(String(p)).endsWith('/project/package.json')
    )
    ;(fs.readFileSync as any).mockImplementation(() => '')
    ;(fs.readdirSync as any).mockImplementation((p: string) => {
      const s = toPosix(String(p))
      if (s.endsWith('/project')) {
        return [
          {isFile: () => false, isDirectory: () => true, name: 'newtab'},
          {isFile: () => false, isDirectory: () => true, name: 'node_modules'}
        ]
      }
      if (s.endsWith('/project/newtab')) {
        return [
          {isFile: () => true, isDirectory: () => false, name: 'index.tsx'}
        ]
      }
      return []
    })

    const {ensureTypeScriptConfig} = await import('../../js-tools/typescript')
    ensureTypeScriptConfig('/project')

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('a no-op call does not latch away a later real setup call', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) =>
      toPosix(String(p)).endsWith('/project/package.json')
    )
    ;(fs.readFileSync as any).mockImplementation(() => '')
    ;(fs.readdirSync as any).mockImplementation((p: string) => {
      if (toPosix(String(p)).endsWith('/project')) {
        return [{isFile: () => true, isDirectory: () => false, name: 'a.ts'}]
      }
      return []
    })

    const {ensureTypeScriptConfig} = await import('../../js-tools/typescript')
    // First call sees no project shape at all and must not set the latch.
    ensureTypeScriptConfig('/elsewhere')
    expect(fs.writeFileSync).not.toHaveBeenCalled()

    ensureTypeScriptConfig('/project')
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('maybeUseTypeScript returns true when tsconfig exists and typescript resolves', async () => {
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
    ;(fs.existsSync as any).mockImplementation(
      (p: string) =>
        toPosix(String(p)).endsWith('/project/tsconfig.json') ||
        toPosix(String(p)).endsWith('/project/package.json')
    )
    ;(fs.readFileSync as any).mockImplementation((p: string) => {
      if (toPosix(String(p)).endsWith('package.json')) {
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
    expect(compilerOptions.moduleResolution).toBe('bundler')
    expect(compilerOptions.module).toBe('esnext')
  })
})
