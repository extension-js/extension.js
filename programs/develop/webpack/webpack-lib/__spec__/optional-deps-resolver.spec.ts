import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

let developInstallRoot: string | undefined
const installOptionalDependenciesMock = vi.fn()

vi.mock('../../plugin-css/css-lib/integrations', () => ({
  installOptionalDependencies: (...args: unknown[]) =>
    installOptionalDependenciesMock(...args),
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

  beforeEach(() => {
    vi.resetModules()
    installOptionalDependenciesMock.mockReset()
    projectPath = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-project-'))
    runtimePath = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-runtime-'))
    writeJson(path.join(projectPath, 'package.json'), {name: 'test-project'})
    writeJson(path.join(runtimePath, 'package.json'), {
      name: 'extension-develop'
    })
    developInstallRoot = runtimePath
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
    fs.rmSync(runtimePath, {recursive: true, force: true})
    developInstallRoot = undefined
  })

  it('resolves optional package from project root when already installed', async () => {
    const dependencyId = '@extjs-test/postcss-loader'
    createPackage(
      projectPath,
      dependencyId,
      'module.exports = {name: "postcss-loader"}'
    )
    installOptionalDependenciesMock.mockResolvedValue(true)

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
    expect(installOptionalDependenciesMock).not.toHaveBeenCalled()
  })

  it('dedupes concurrent installs using single-flight', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    installOptionalDependenciesMock.mockImplementation(async () => {
      createPackage(runtimePath, dependencyId, 'module.exports = {ok: true}')
      return true
    })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const [a, b] = await Promise.all([
      ensureOptionalPackageResolved({
        integration: 'React',
        projectPath,
        dependencyId,
        installDependencies: [dependencyId],
        verifyPackageIds: [dependencyId]
      }),
      ensureOptionalPackageResolved({
        integration: 'React',
        projectPath,
        dependencyId,
        installDependencies: [dependencyId],
        verifyPackageIds: [dependencyId]
      })
    ])

    expect(a).toContain('react-refresh')
    expect(b).toContain('react-refresh')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
  })

  it('fails with diagnostics when install succeeds but package is missing', async () => {
    const dependencyId = '@extjs-test/missing-loader'
    installOptionalDependenciesMock.mockResolvedValue(true)

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    await expect(
      ensureOptionalPackageResolved({
        integration: 'PostCSS',
        projectPath,
        dependencyId,
        installDependencies: [dependencyId],
        verifyPackageIds: [dependencyId]
      })
    ).rejects.toThrow(
      'Optional dependency install reported success but packages are missing'
    )
  })

  it('loads optional module with adapter after deterministic resolution', async () => {
    const dependencyId = '@extjs-test/plugin-react-refresh'
    installOptionalDependenciesMock.mockImplementation(async () => {
      createPackage(
        runtimePath,
        dependencyId,
        'module.exports = { default: class ReactRefreshPlugin {} }'
      )
      return true
    })

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
