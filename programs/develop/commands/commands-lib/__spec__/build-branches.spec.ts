import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Import from source to enable granular mocking
import {extensionBuild} from '../../build'

// Define hoisted module paths for usage within vi.mock (which is hoisted)
// eslint-disable-next-line vitest/no-conditional-in-test
const RESOLVE = vi.hoisted(() => {
  const pathMod = require('path') as typeof import('path')
  const BUILD_DIR = pathMod.resolve(__dirname, '..', '..')
  return {
    webpackConfig: pathMod.resolve(
      BUILD_DIR,
      '..',
      'webpack',
      'webpack-config'
    ),
    getProjectPath: pathMod.resolve(
      BUILD_DIR,
      'commands-lib',
      'get-project-path'
    ),
    installDeps: pathMod.resolve(
      BUILD_DIR,
      'commands-lib',
      'install-dependencies'
    ),
    validateUserDeps: pathMod.resolve(
      BUILD_DIR,
      'commands-lib',
      'validate-user-dependencies'
    ),
    generateZip: pathMod.resolve(BUILD_DIR, 'commands-lib', 'generate-zip'),
    getExtensionConfig: pathMod.resolve(
      BUILD_DIR,
      'commands-lib',
      'get-extension-config'
    )
  }
})

function createTempProject(): {root: string; manifest: string; pkg: string} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-build-'))
  const manifestPath = path.join(root, 'manifest.json')
  const packageJsonPath = path.join(root, 'package.json')

  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      name: 'temp-ext',
      version: '0.0.1',
      manifest_version: 3
    })
  )

  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify({name: 'temp-ext', version: '0.0.1'})
  )

  return {root, manifest: manifestPath, pkg: packageJsonPath}
}

// Common mocks for rspack and webpackConfig to keep tests fast and deterministic
vi.mock('@rspack/core', () => {
  return {
    rspack: vi.fn(() => ({
      run: (cb: (err: any, stats: any) => void) => {
        cb(null, {
          hasErrors: () => false,
          toJson: () => ({time: 10}),
          toString: () => 'ok'
        })
      }
    }))
  }
})

let capturedDevOptions: any
vi.mock(RESOLVE.webpackConfig, () => {
  const def = vi.fn((_project: any, devOptions: any) => {
    capturedDevOptions = devOptions
    return {
      mode: 'production',
      plugins: [
        {constructor: {name: 'plugin-browsers'}},
        {constructor: {name: 'plugin-reload'}},
        {constructor: {name: 'OtherPlugin'}}
      ],
      output: {path: '/dev/null'}
    }
  })
  return {default: def}
})

vi.mock(RESOLVE.getProjectPath, async (orig) => {
  // Use actual implementation for types; the tests will stub return values via spies when needed
  // but we provide a default implementation that will be overridden per-test with spies
  const actual = await (orig as any)()
  return {
    ...actual
  }
})

vi.mock(RESOLVE.installDeps, () => {
  return {
    installDependencies: vi.fn(async () => undefined)
  }
})

vi.mock(RESOLVE.validateUserDeps, () => {
  return {
    assertNoManagedDependencyConflicts: vi.fn(() => undefined)
  }
})

vi.mock(RESOLVE.generateZip, () => {
  return {
    generateZip: vi.fn(async () => undefined)
  }
})

vi.mock(RESOLVE.getExtensionConfig, () => {
  return {
    loadCustomWebpackConfig: vi.fn(async () => {
      return (passedConfig: any) => passedConfig
    })
  }
})

describe('extensionBuild branches', () => {
  const originalEnv = {...process.env}
  let temp: {root: string; manifest: string; pkg: string}

  beforeEach(() => {
    temp = createTempProject()
    process.env.VITEST = ''
  })

  afterEach(() => {
    process.env = {...originalEnv}
    try {
      fs.rmSync(temp.root, {recursive: true, force: true})
    } catch {}
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('installs dependencies when node_modules is missing and not under vitest', async () => {
    const getProjectSpy = vi
      .spyOn(await import(RESOLVE.getProjectPath), 'getProjectStructure' as any)
      .mockResolvedValue({
        manifestPath: temp.manifest,
        packageJsonPath: temp.pkg
      })

    const install = (await import(RESOLVE.installDeps))
      .installDependencies as unknown as ReturnType<typeof vi.fn>

    // Ensure node_modules does not exist
    const nodeModulesPath = path.join(path.dirname(temp.pkg), 'node_modules')
    if (fs.existsSync(nodeModulesPath))
      fs.rmSync(nodeModulesPath, {recursive: true})

    await extensionBuild(temp.root, {browser: 'chrome', silent: true})

    expect(getProjectSpy).toHaveBeenCalled()
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('does not install dependencies when node_modules exists', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    // Create node_modules
    fs.mkdirSync(path.join(path.dirname(temp.pkg), 'node_modules'))

    const install = (await import(RESOLVE.installDeps))
      .installDependencies as unknown as ReturnType<typeof vi.fn>

    await extensionBuild(temp.root, {browser: 'chrome', silent: true})
    expect(install).not.toHaveBeenCalled()
  })

  it('calls generateZip when only zipSource is true', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    const genZip = (await import(RESOLVE.generateZip))
      .generateZip as unknown as ReturnType<typeof vi.fn>

    await extensionBuild(temp.root, {
      browser: 'chrome',
      silent: true,
      zipSource: true
    })
    expect(genZip).toHaveBeenCalledTimes(1)
  })

  it('supports custom zip filename for source', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    const genZip = (await import(RESOLVE.generateZip))
      .generateZip as unknown as ReturnType<typeof vi.fn>

    await extensionBuild(temp.root, {
      browser: 'chrome',
      silent: true,
      zip: true,
      zipSource: true,
      zipFilename: 'custom-name'
    })

    // Expect generateZip called with the filename option intact
    expect(genZip).toHaveBeenCalled()
    const call = genZip.mock.calls[0]
    expect(call?.[1]?.zipFilename).toBe('custom-name')
  })

  it('filters browser runner plugins before passing to user config', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    let pluginsSeen: any[] | undefined
    ;(await import(RESOLVE.getExtensionConfig)).loadCustomWebpackConfig = vi.fn(
      async () => {
        return (passed: any) => {
          pluginsSeen = passed.plugins
          return passed
        }
      }
    ) as any

    await extensionBuild(temp.root, {browser: 'chrome', silent: true})

    expect(Array.isArray(pluginsSeen)).toBe(true)
    // Should remove both plugin-browsers and plugin-reload
    expect(
      pluginsSeen!.find((p) => p?.constructor?.name === 'plugin-browsers')
    ).toBeUndefined()
    expect(
      pluginsSeen!.find((p) => p?.constructor?.name === 'plugin-reload')
    ).toBeUndefined()
    // Other plugins remain
    expect(
      pluginsSeen!.find((p) => p?.constructor?.name === 'OtherPlugin')
    ).toBeTruthy()
  })

  it('propagates polyfill flag into webpack config', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    await extensionBuild(temp.root, {
      browser: 'chrome',
      silent: true,
      polyfill: true
    })
    expect(capturedDevOptions?.polyfill).toBe(true)
  })

  it('exits and logs error when compiler callback receives an error', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    // Mock rspack to callback with an error
    const rspackMod = await import('@rspack/core')
    ;(rspackMod as any).rspack = vi.fn(() => ({
      run: (cb: (err: any, stats: any) => void) => cb(new Error('boom'), null)
    }))

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as any)

    process.env.EXTENSION_ENV = 'development'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await extensionBuild(temp.root, {browser: 'chrome', silent: true})

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('exits when stats.hasErrors() is true', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    const rspackMod = await import('@rspack/core')
    ;(rspackMod as any).rspack = vi.fn(() => ({
      run: (cb: (err: any, stats: any) => void) =>
        cb(null, {
          hasErrors: () => true,
          toString: () => 'err',
          toJson: () => ({time: 5})
        })
    }))

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as any)

    // Do not await to avoid hanging on unresolved promise
    void extensionBuild(temp.root, {browser: 'chrome'})
    await new Promise((r) => setImmediate(r))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('aborts build when managed dependency conflicts are detected', async () => {
    vi.spyOn(
      await import(RESOLVE.getProjectPath),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })
    ;(
      await import('../validate-user-dependencies')
    ).assertNoManagedDependencyConflicts = vi.fn(() => {
      throw new Error('conflict')
    }) as any

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as any)
    process.env.EXTENSION_ENV = 'development'

    await extensionBuild(temp.root, {browser: 'chrome', silent: true})
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('respects silent flag by suppressing console.log', async () => {
    vi.spyOn(
      await import('../get-project-path'),
      'getProjectStructure' as any
    ).mockResolvedValue({
      manifestPath: temp.manifest,
      packageJsonPath: temp.pkg
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Ensure no-install path to avoid install log
    fs.mkdirSync(path.join(path.dirname(temp.pkg), 'node_modules'))
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as any)
    await extensionBuild(temp.root, {browser: 'chrome', silent: true})
    // Only build logs should be suppressed; allow non-build logs (like internal counters)
    const buildLogs = logSpy.mock.calls.filter((c) =>
      String(c[0] ?? '')
        .toString()
        .includes('Building')
    )
    expect(buildLogs.length).toBe(0)
    // Do not assert exit here; separate tests cover exit behavior
  })
})
