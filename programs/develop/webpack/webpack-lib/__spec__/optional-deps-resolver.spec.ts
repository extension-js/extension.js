import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

let developInstallRoot: string | undefined
let optionalInstallRoot: string | undefined
const installOptionalDependenciesMock = vi.fn()

vi.mock('../../plugin-css/css-lib/integrations', () => ({
  installOptionalDependencies: (...args: unknown[]) =>
    installOptionalDependenciesMock(...args),
  resolveDevelopInstallRoot: () => developInstallRoot,
  resolveOptionalInstallRoot: () => optionalInstallRoot
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
    optionalInstallRoot = runtimePath
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
    fs.rmSync(runtimePath, {recursive: true, force: true})
    developInstallRoot = undefined
    optionalInstallRoot = undefined
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

  it('resolves from install root package exports without triggering install', async () => {
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
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}exported-loader${path.sep}dist${path.sep}index.cjs`
    )
    expect(installOptionalDependenciesMock).not.toHaveBeenCalled()
  })

  it('does not require a second run after successful first install', async () => {
    const dependencyId = '@extjs-test/first-run-loader'
    installOptionalDependenciesMock.mockImplementation(async () => {
      createPackage(
        runtimePath,
        dependencyId,
        'module.exports = {name: "first-run-loader"}'
      )
      return true
    })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const firstResolvedPath = await ensureOptionalPackageResolved({
      integration: 'PostCSS',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId],
      verifyPackageIds: [dependencyId]
    })
    const secondResolvedPath = await ensureOptionalPackageResolved({
      integration: 'PostCSS',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId],
      verifyPackageIds: [dependencyId]
    })

    expect(firstResolvedPath).toContain('first-run-loader')
    expect(secondResolvedPath).toContain('first-run-loader')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
  })

  it('retries install on next call after a failed first attempt', async () => {
    const dependencyId = '@extjs-test/retry-loader'
    installOptionalDependenciesMock
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        createPackage(runtimePath, dependencyId, 'module.exports = {ok: true}')
        return true
      })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    await expect(
      ensureOptionalPackageResolved({
        integration: 'React',
        projectPath,
        dependencyId,
        installDependencies: [dependencyId],
        verifyPackageIds: [dependencyId]
      })
    ).rejects.toThrow('Optional dependencies failed to install')

    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'React',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId],
      verifyPackageIds: [dependencyId]
    })

    expect(resolvedPath).toContain('retry-loader')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(2)
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

  it('retries a partial React install before failing verification', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    const pluginId = '@extjs-test/plugin-react-refresh'

    installOptionalDependenciesMock
      .mockImplementationOnce(async () => {
        createPackage(
          runtimePath,
          pluginId,
          'module.exports = { default: class ReactRefreshPlugin {} }'
        )
        return true
      })
      .mockImplementationOnce(async () => {
        createPackage(runtimePath, dependencyId, 'module.exports = {ok: true}')
        return true
      })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'React',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId, pluginId],
      verifyPackageIds: [dependencyId, pluginId]
    })

    expect(resolvedPath).toContain(
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}react-refresh${path.sep}index.js`
    )
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(2)
  })

  it('retries a partial single-package install before failing verification', async () => {
    const dependencyId = '@extjs-test/postcss-loader'

    installOptionalDependenciesMock
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(async () => {
        createPackage(runtimePath, dependencyId, 'module.exports = {ok: true}')
        return true
      })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'PostCSS',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId],
      verifyPackageIds: [dependencyId]
    })

    expect(resolvedPath).toContain(
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}postcss-loader${path.sep}index.js`
    )
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(2)
  })

  it('retries a partial Preact install before failing verification', async () => {
    const dependencyId = '@extjs-test/plugin-preact-refresh'
    const preactDependencies = [
      '@extjs-test/core',
      '@extjs-test/utils',
      '@extjs-test/preact',
      dependencyId
    ]

    installOptionalDependenciesMock
      .mockImplementationOnce(async () => {
        createPackage(
          runtimePath,
          dependencyId,
          'module.exports = { default: class PreactRefreshPlugin {} }'
        )
        return true
      })
      .mockImplementationOnce(async () => {
        createPackage(runtimePath, '@extjs-test/core', 'module.exports = {}')
        createPackage(runtimePath, '@extjs-test/utils', 'module.exports = {}')
        createPackage(runtimePath, '@extjs-test/preact', 'module.exports = {}')
        return true
      })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'Preact',
      projectPath,
      dependencyId,
      installDependencies: preactDependencies,
      verifyPackageIds: preactDependencies
    })

    expect(resolvedPath).toContain(
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}plugin-preact-refresh${path.sep}index.js`
    )
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(2)
  })

  it('retries a partial Vue install before failing verification', async () => {
    const dependencyId = '@extjs-test/vue-loader'
    const compilerId = '@extjs-test/compiler-sfc'
    const vueId = '@extjs-test/vue'

    installOptionalDependenciesMock
      .mockImplementationOnce(async () => {
        createPackage(
          runtimePath,
          dependencyId,
          'module.exports = {name: "runtime-vue-loader"}'
        )
        return true
      })
      .mockImplementationOnce(async () => {
        createPackage(runtimePath, compilerId, 'module.exports = {ok: true}')
        createPackage(runtimePath, vueId, 'module.exports = {ok: true}')
        return true
      })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'Vue',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId, compilerId, vueId],
      verifyPackageIds: [dependencyId, compilerId, vueId]
    })

    expect(resolvedPath).toContain(
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}vue-loader${path.sep}index.js`
    )
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(2)
  })

  it('resolves React refresh from a nested plugin install tree', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    const pluginId = '@extjs-test/plugin-react-refresh'

    installOptionalDependenciesMock.mockImplementation(async () => {
      createPackage(
        runtimePath,
        pluginId,
        'module.exports = { default: class ReactRefreshPlugin {} }'
      )
      createPackage(
        path.join(runtimePath, 'node_modules', ...pluginId.split('/')),
        dependencyId,
        'module.exports = {runtime: true}'
      )
      return true
    })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )

    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'React',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId, pluginId],
      verifyPackageIds: [dependencyId, pluginId]
    })

    expect(resolvedPath).toContain(
      `${path.sep}@extjs-test${path.sep}plugin-react-refresh${path.sep}node_modules${path.sep}@extjs-test${path.sep}react-refresh${path.sep}index.js`
    )
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
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

  it('installs when pre-resolved package misses runtime peer dependency', async () => {
    const dependencyId = '@extjs-test/vue-loader'
    const peerId = '@extjs-test/compiler-sfc'

    // Simulate a pre-resolved package in projectPath that cannot resolve peerId.
    createPackage(
      projectPath,
      dependencyId,
      'module.exports = {name: "project-vue-loader"}'
    )

    installOptionalDependenciesMock.mockImplementation(async () => {
      createPackage(
        runtimePath,
        dependencyId,
        'module.exports = {name: "runtime-vue-loader"}'
      )
      createPackage(runtimePath, peerId, 'module.exports = {ok: true}')
      return true
    })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'Vue',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId, peerId],
      verifyPackageIds: [dependencyId, peerId]
    })

    expect(resolvedPath).toContain('tmp-extjs-runtime-')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
  })

  it('does not enforce peer runtime checks for non-Vue integrations', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    const peerId = '@extjs-test/plugin-react-refresh'

    createPackage(
      projectPath,
      dependencyId,
      'module.exports = {name: "project-react-refresh"}'
    )
    installOptionalDependenciesMock.mockResolvedValue(true)

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'React',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId, peerId],
      verifyPackageIds: [dependencyId, peerId]
    })

    expect(resolvedPath).toContain(
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}react-refresh${path.sep}index.js`
    )
    expect(installOptionalDependenciesMock).not.toHaveBeenCalled()
  })

  it('installs for Vue when peer resolves but cannot be required', async () => {
    const dependencyId = '@extjs-test/vue-loader'
    const peerId = '@extjs-test/compiler-sfc'

    createPackage(
      projectPath,
      dependencyId,
      'module.exports = {name: "project-vue-loader"}'
    )
    createPackage(
      projectPath,
      peerId,
      'throw new Error("broken peer in project tree")'
    )

    installOptionalDependenciesMock.mockImplementation(async () => {
      createPackage(
        runtimePath,
        dependencyId,
        'module.exports = {name: "runtime-vue-loader"}'
      )
      createPackage(runtimePath, peerId, 'module.exports = {ok: true}')
      return true
    })

    const {ensureOptionalPackageResolved} = await import(
      '../optional-deps-resolver'
    )
    const resolvedPath = await ensureOptionalPackageResolved({
      integration: 'Vue',
      projectPath,
      dependencyId,
      installDependencies: [dependencyId, peerId],
      verifyPackageIds: [dependencyId, peerId]
    })

    expect(resolvedPath).toContain('tmp-extjs-runtime-')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
  })
})
