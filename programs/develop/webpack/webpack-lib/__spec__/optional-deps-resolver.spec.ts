import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

let developInstallRoot: string | undefined
let optionalInstallRoot: string | undefined
const installOptionalDependenciesMock = vi.fn()

vi.mock('../../optional-deps-lib', () => ({
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

function createPnpmStorePackage(
  rootDir: string,
  storeKey: string,
  packageId: string,
  source: string
) {
  const packageDir = path.join(
    rootDir,
    'node_modules',
    '.pnpm',
    storeKey,
    'node_modules',
    ...packageId.split('/')
  )
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
    installOptionalDependenciesMock.mockReset()
    projectPath = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-project-'))
    runtimePath = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-runtime-'))
    auxPaths = []
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
    for (const extraPath of auxPaths) {
      fs.rmSync(extraPath, {recursive: true, force: true})
    }
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

  it('tops up only missing deps after retry still leaves partial install', async () => {
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
      .mockImplementationOnce(async () => true)
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
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(3)
    expect(installOptionalDependenciesMock.mock.calls[2]?.[1]).toEqual([
      dependencyId
    ])
  })

  it('force-cleans install root when retries still leave a partial cache', async () => {
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
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => {
        createPackage(runtimePath, dependencyId, 'module.exports = {ok: true}')
        createPackage(
          runtimePath,
          pluginId,
          'module.exports = { default: class ReactRefreshPlugin {} }'
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
      `${path.sep}node_modules${path.sep}@extjs-test${path.sep}react-refresh${path.sep}index.js`
    )
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(4)
    expect(installOptionalDependenciesMock.mock.calls[3]?.[1]).toEqual([
      dependencyId,
      pluginId
    ])
    expect(installOptionalDependenciesMock.mock.calls[3]?.[2]).toMatchObject({
      forceRecreateInstallRoot: true
    })
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

  it('verifies a pnpm store-backed React contract at install root', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    const pluginId = '@extjs-test/plugin-react-refresh'
    const storeKey = '@extjs-test+plugin-react-refresh@0.0.0'

    createPnpmStorePackage(
      runtimePath,
      storeKey,
      pluginId,
      'module.exports = { default: class ReactRefreshPlugin {} }'
    )
    createPnpmStorePackage(
      runtimePath,
      storeKey,
      dependencyId,
      'module.exports = {runtime: true}'
    )

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

    const externalRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp-extjs-link-'))
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
      contract: {
        id: 'test-vue',
        integration: 'Vue',
        installPackages: [dependencyId, peerId],
        verificationRules: [
          {type: 'install-root', packageId: dependencyId},
          {type: 'install-root', packageId: peerId},
          {
            type: 'module-context-resolve',
            fromPackage: dependencyId,
            packageId: peerId
          }
        ]
      }
    })

    expect(resolvedPath).toContain('tmp-extjs-runtime-')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
  })

  it('installs for React when peer is missing from module context', async () => {
    const dependencyId = '@extjs-test/react-refresh'
    const peerId = '@extjs-test/plugin-react-refresh'

    createPackage(
      projectPath,
      dependencyId,
      'module.exports = {name: "project-react-refresh"}'
    )
    installOptionalDependenciesMock.mockImplementation(async () => {
      createPackage(
        runtimePath,
        dependencyId,
        'module.exports = {name: "runtime-react-refresh"}'
      )
      createPackage(
        runtimePath,
        peerId,
        'module.exports = {name: "runtime-plugin-react-refresh"}'
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
      contract: {
        id: 'test-react-refresh',
        integration: 'React',
        installPackages: [dependencyId, peerId],
        verificationRules: [
          {type: 'install-root', packageId: dependencyId},
          {type: 'install-root', packageId: peerId},
          {
            type: 'module-context-resolve',
            fromPackage: peerId,
            packageId: dependencyId
          }
        ]
      }
    })

    expect(resolvedPath).toContain('tmp-extjs-runtime-')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
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
      contract: {
        id: 'test-vue',
        integration: 'Vue',
        installPackages: [dependencyId, peerId],
        verificationRules: [
          {type: 'install-root', packageId: dependencyId},
          {type: 'install-root', packageId: peerId},
          {
            type: 'module-context-load',
            fromPackage: dependencyId,
            packageId: peerId
          }
        ]
      }
    })

    expect(resolvedPath).toContain('tmp-extjs-runtime-')
    expect(installOptionalDependenciesMock).toHaveBeenCalledTimes(1)
  })
})
