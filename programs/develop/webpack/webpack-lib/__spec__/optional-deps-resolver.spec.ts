import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

let developInstallRoot: string | undefined

vi.mock('../develop-context', () => ({
  resolveDevelopInstallRoot: () => developInstallRoot
}))

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function createPackage(rootDir: string, packageId: string, source: string) {
  const packageDir = path.join(rootDir, 'node_modules', ...packageId.split('/'))
  fs.mkdirSync(packageDir, {recursive: true})
  writeJson(path.join(packageDir, 'package.json'), {
    name: packageId,
    version: '0.0.0',
    main: 'index.js'
  })
  fs.writeFileSync(path.join(packageDir, 'index.js'), source, 'utf8')
}

describe('optional-deps-resolver', () => {
  let projectPath: string
  let runtimePath: string
  let auxPaths: string[]

  beforeEach(() => {
    vi.resetModules()
    projectPath = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-project-'))
    runtimePath = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-runtime-'))
    auxPaths = []
    writeJson(path.join(projectPath, 'package.json'), {name: 'test-project'})
    writeJson(path.join(runtimePath, 'package.json'), {
      name: 'extension-develop',
      version: '0.0.0'
    })
    developInstallRoot = runtimePath
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
    fs.rmSync(runtimePath, {recursive: true, force: true})
    for (const extraPath of auxPaths) {
      fs.rmSync(extraPath, {recursive: true, force: true})
    }
    developInstallRoot = undefined
  })

  it('resolves optional package from project root when already installed', async () => {
    const dependencyId = '@extjs-test/postcss-loader'
    createPackage(
      projectPath,
      dependencyId,
      'module.exports = {name: "postcss-loader"}'
    )

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'PostCSS',
      projectPath,
      dependencyId
    })

    expect(resolvedPath).toContain(
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}postcss-loader${path.sep}index.js`
    )
  })

  it('resolves from extension-develop root when absent from project', async () => {
    const dependencyId = '@extjs-test/postcss-loader'
    createPackage(
      runtimePath,
      dependencyId,
      'module.exports = {name: "postcss-loader"}'
    )

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'PostCSS',
      projectPath,
      dependencyId
    })

    expect(resolvedPath).toContain('postcss-loader')
    expect(resolvedPath).toContain('tmp-extjs-runtime-')
  })

  it('resolves from install root package exports', async () => {
    const dependencyId = '@extjs-test/exported-loader'
    const packageDir = path.join(
      runtimePath,
      'node_modules',
      ...dependencyId.split('/')
    )

    fs.mkdirSync(path.join(packageDir, 'dist'), {recursive: true})
    writeJson(path.join(packageDir, 'package.json'), {
      name: dependencyId,
      version: '0.0.0',
      exports: {
        '.': {
          require: './dist/index.cjs'
        }
      }
    })
    fs.writeFileSync(
      path.join(packageDir, 'dist', 'index.cjs'),
      'module.exports = {name: "exported-loader"}',
      'utf8'
    )

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'PostCSS',
      projectPath,
      dependencyId
    })

    expect(resolvedPath).toContain(
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}exported-loader${path.sep}dist${path.sep}index.cjs`
    )
  })

  it('rejects when package is missing everywhere', async () => {
    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    await expect(
      ensureOptionalPackageResolved({
        integration: 'PostCSS',
        projectPath,
        dependencyId: '@extjs-test/missing'
      })
    ).rejects.toThrow(/could not be resolved/)
  })

  it('verifies React refresh contract at a flat install root', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    const pluginId = '@extjs-test/plugin-react-refresh'

    createPackage(
      runtimePath,
      pluginId,
      'module.exports = { default: class ReactRefreshPlugin {} }'
    )
    createPackage(runtimePath, dependencyId, 'module.exports = {runtime: true}')

    const {getContractVerificationFailuresAtInstallRoot} = await import(
      '../optional-deps-resolver'
    )

    const failures = getContractVerificationFailuresAtInstallRoot(
      {
        id: 'test-react-refresh',
        integration: 'React',
        installPackages: [dependencyId, pluginId],
        verificationRules: [
          {type: 'install-root', packageId: dependencyId},
          {type: 'install-root', packageId: pluginId},
          {
            type: 'module-context-resolve',
            fromPackage: pluginId,
            packageId: dependencyId
          }
        ]
      },
      runtimePath
    )

    expect(failures).toEqual([])
  })

  it('accepts module-context peer resolution through an alias of the installed package', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    const pluginId = '@extjs-test/plugin-react-refresh'

    createPackage(runtimePath, dependencyId, 'module.exports = {runtime: true}')
    createPackage(
      runtimePath,
      pluginId,
      'module.exports = { default: class ReactRefreshPlugin {} }'
    )

    const externalRoot = fs.mkdtempSync(
      path.join(process.cwd(), 'tmp-extjs-link-')
    )
    auxPaths.push(externalRoot)
    const aliasDir = path.join(externalRoot, 'react-refresh-alias')
    fs.symlinkSync(
      path.join(runtimePath, 'node_modules', ...dependencyId.split('/')),
      aliasDir,
      'junction'
    )

    const pluginEntryPath = path.join(
      runtimePath,
      'node_modules',
      ...pluginId.split('/'),
      'index.js'
    )
    const externalResolvedPath = path.join(aliasDir, 'index.js')

    vi.doMock('module', async () => {
      const actual = await vi.importActual<typeof import('module')>('module')

      return {
        ...actual,
        createRequire: (specifier: string) => {
          const req = actual.createRequire(specifier)
          const wrapped = ((id: string) => req(id)) as NodeRequire
          Object.assign(wrapped, req)
          wrapped.resolve = ((id: string) => {
            if (specifier === pluginEntryPath && id === dependencyId) {
              return externalResolvedPath
            }
            return req.resolve(id)
          }) as NodeJS.RequireResolve
          return wrapped
        }
      }
    })

    const {getContractVerificationFailuresAtInstallRoot} = await import(
      '../optional-deps-resolver'
    )

    const failures = getContractVerificationFailuresAtInstallRoot(
      {
        id: 'test-react-refresh-aliased-peer',
        integration: 'React',
        installPackages: [dependencyId, pluginId],
        verificationRules: [
          {type: 'install-root', packageId: dependencyId},
          {type: 'install-root', packageId: pluginId},
          {
            type: 'module-context-resolve',
            fromPackage: pluginId,
            packageId: dependencyId
          }
        ]
      },
      runtimePath
    )

    expect(failures).toEqual([])
  })

  it('loads optional module with adapter after deterministic resolution', async () => {
    const dependencyId = '@extjs-test/plugin-react-refresh'
    createPackage(
      runtimePath,
      dependencyId,
      'module.exports = { default: class ReactRefreshPlugin {} }'
    )

    const {ensureOptionalModuleLoaded} = await import(
      '../optional-deps-resolver'
    )
    const pluginCtor = await ensureOptionalModuleLoaded<any>({
      integration: 'React',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId],
      verifyPackageIds: [dependencyId],
      moduleAdapter: (mod: any) => mod.default || mod
    })

    expect(typeof pluginCtor).toBe('function')
  })
})
