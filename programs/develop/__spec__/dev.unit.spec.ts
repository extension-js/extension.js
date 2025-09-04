// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██╔══██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Mocks for non-fs collaborators
const devServerMock = vi.fn(async () => {})
vi.mock('../webpack/dev-server', () => ({
  devServer: devServerMock
}))

const generateExtensionTypesMock = vi.fn(async () => {})
vi.mock('../develop-lib/generate-extension-types', () => ({
  generateExtensionTypes: generateExtensionTypesMock
}))

const isUsingTypeScriptMock = vi.fn(() => false)
vi.mock('../webpack/plugin-js-frameworks/js-tools/typescript', () => ({
  isUsingTypeScript: isUsingTypeScriptMock
}))

const installDependenciesMock = vi.fn(async () => {})
vi.mock('../develop-lib/install-dependencies', () => ({
  installDependencies: installDependenciesMock
}))

const assertNoManagedDependencyConflictsMock = vi.fn(() => {})
vi.mock('../develop-lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: assertNoManagedDependencyConflictsMock
}))

// Mock project structure provider
let manifestPath: string
let packageJsonPath: string
let packageJsonDir: string

const getProjectStructureMock = vi.fn(async () => ({
  manifestPath,
  packageJsonPath
}))
vi.mock('../develop-lib/get-project-path', () => ({
  getProjectStructure: getProjectStructureMock
}))

describe('extensionDev unit', () => {
  const originalEnv = {...process.env}

  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    process.env = {...originalEnv}

    // Use a repo-local tmp base to avoid absolute-root paths on some systems
    const repoTmpBase = path.resolve(__dirname, '../../.tmp-tests')
    fs.mkdirSync(repoTmpBase, {recursive: true})
    const tmpRoot = fs.mkdtempSync(path.join(repoTmpBase, 'ext-dev-unit-'))
    packageJsonDir = tmpRoot
    manifestPath = path.join(tmpRoot, 'manifest.json')
    packageJsonPath = path.join(tmpRoot, 'package.json')

    fs.writeFileSync(manifestPath, JSON.stringify({name: 'x'}))
    fs.writeFileSync(packageJsonPath, JSON.stringify({name: 'x'}))
    fs.mkdirSync(path.join(tmpRoot, 'node_modules'), {recursive: true})

    isUsingTypeScriptMock.mockReturnValue(false)
    devServerMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(manifestPath), {recursive: true, force: true})
    } catch {}
  })

  it('calls generateExtensionTypes when using TypeScript', async () => {
    isUsingTypeScriptMock.mockReturnValue(true)
    const {extensionDev} = await import('../dev')

    await extensionDev(packageJsonDir, {browser: 'chrome', mode: 'development'})

    expect(generateExtensionTypesMock).toHaveBeenCalledTimes(1)
    expect(generateExtensionTypesMock).toHaveBeenCalledWith(
      path.dirname(manifestPath)
    )
  })

  it('skips generateExtensionTypes when not using TypeScript', async () => {
    isUsingTypeScriptMock.mockReturnValue(false)
    const {extensionDev} = await import('../dev')

    await extensionDev(packageJsonDir, {browser: 'chrome', mode: 'development'})

    expect(generateExtensionTypesMock).not.toHaveBeenCalled()
  })

  it('asserts managed dependency conflicts using package.json and manifest dirs', async () => {
    const {extensionDev} = await import('../dev')

    await extensionDev(packageJsonDir, {browser: 'chrome', mode: 'development'})

    expect(assertNoManagedDependencyConflictsMock).toHaveBeenCalledTimes(1)
    expect(assertNoManagedDependencyConflictsMock).toHaveBeenCalledWith(
      packageJsonPath,
      path.dirname(manifestPath)
    )
  })

  it('installs dependencies when node_modules is missing', async () => {
    fs.rmSync(path.join(packageJsonDir, 'node_modules'), {
      recursive: true,
      force: true
    })
    const {extensionDev} = await import('../dev')

    await extensionDev(packageJsonDir, {browser: 'chrome', mode: 'development'})

    expect(installDependenciesMock).toHaveBeenCalledTimes(1)
    expect(installDependenciesMock).toHaveBeenCalledWith(packageJsonDir)
  })

  it('skips install when node_modules exists', async () => {
    const nm = path.join(packageJsonDir, 'node_modules')
    fs.mkdirSync(nm, {recursive: true})
    // Ensure directory is non-empty to reflect real projects
    fs.writeFileSync(path.join(nm, '.placeholder'), '')
    const {extensionDev} = await import('../dev')

    await extensionDev(packageJsonDir, {browser: 'chrome', mode: 'development'})

    expect(installDependenciesMock).not.toHaveBeenCalled()
  })

  it('passes merged options to devServer and defaults browser to chrome', async () => {
    const {extensionDev} = await import('../dev')

    await extensionDev(packageJsonDir, {mode: 'development'} as any)

    expect(devServerMock).toHaveBeenCalledTimes(1)
    const options = (devServerMock.mock.calls as any)[0][1] as any
    expect(options.mode).toBe('development')
    expect(options.browser).toBe('chrome')
  })

  it('forwards explicit dev options to devServer', async () => {
    const {extensionDev} = await import('../dev')

    await extensionDev(packageJsonDir, {
      browser: 'firefox',
      mode: 'development',
      open: false,
      port: 1234,
      profile: false,
      source: 'https://example.com',
      watchSource: true
    })

    const options = (devServerMock.mock.calls as any)[0][1] as any
    expect(options.browser).toBe('firefox')
    expect(options.mode).toBe('development')
    expect(options.open).toBe(false)
    expect(options.port).toBe(1234)
    expect(options.source).toBe('https://example.com')
    expect(options.watchSource).toBe(true)
  })

  it('propagates undefined path arg to getProjectStructure', async () => {
    const {extensionDev} = await import('../dev')

    await extensionDev(undefined, {browser: 'chrome', mode: 'development'})
    expect(getProjectStructureMock).toHaveBeenCalledWith(undefined)
  })

  it('logs error and exits(1) when a failure occurs in development env', async () => {
    const error = new Error('boom')
    devServerMock.mockRejectedValueOnce(error)
    process.env.EXTENSION_ENV = 'development'

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      // @ts-expect-error
      .mockImplementation((code: number) => {
        throw new Error(`exit:${code}`)
      })

    const {extensionDev} = await import('../dev')
    await expect(
      extensionDev(packageJsonDir, {browser: 'chrome', mode: 'development'})
    ).rejects.toThrow('exit:1')

    expect(consoleErrorSpy).toHaveBeenCalledWith(error)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
