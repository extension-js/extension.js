import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const originalResolve = (require as any).resolve
const originalPlatform = process.platform
let cacheDir = ''

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true
  })
}

const createSpawn = (
  options: {exitCode?: number; error?: NodeJS.ErrnoException} = {}
) => ({
  on: (event: string, handler: (...args: any[]) => void) => {
    if (event === 'close' && options.exitCode !== undefined) {
      handler(options.exitCode)
    }
    if (event === 'error' && options.error) {
      handler(options.error)
    }
  }
})

function seedInstalledDependency(installRoot: string, dependencyId: string) {
  const packageDir = path.join(
    installRoot,
    'node_modules',
    ...dependencyId.split('/')
  )
  fs.mkdirSync(packageDir, {recursive: true})
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {}')
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({name: dependencyId, version: '0.0.0'})
  )
}

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(() => ({status: 0})),
  spawn: vi.fn(() => createSpawn({exitCode: 0}))
}))

vi.mock('../../webpack-lib/check-build-dependencies', () => ({
  findExtensionDevelopRoot: () => null
}))

describe('optional-deps-lib installer engine', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(require as any).resolve = vi.fn(() => {
      throw new Error('resolve disabled for test')
    })
    delete (process as any).env.EXTENSION_AUTHOR_MODE
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
    delete process.env.NPM_EXEC_PATH
    delete process.env.EXTENSION_JS_PACKAGE_MANAGER
    delete process.env.EXTENSION_JS_PM_EXEC_PATH
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-optlib-'))
    process.env.EXTENSION_JS_CACHE_DIR = cacheDir
  })

  afterEach(() => {
    ;(require as any).resolve = originalResolve
    setPlatform(originalPlatform)
    delete process.env.EXTENSION_JS_CACHE_DIR
    if (cacheDir) {
      fs.rmSync(cacheDir, {recursive: true, force: true})
      cacheDir = ''
    }
  })

  it('installs optional tooling into isolated cache root', async () => {
    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies, resolveOptionalInstallRoot} =
      await import('../index')
    seedInstalledDependency(resolveOptionalInstallRoot(), 'postcss')

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).toHaveBeenCalled()
    expect(spawn.mock.calls[0]?.[2]?.cwd).toContain(
      `${path.sep}optional-deps${path.sep}`
    )
  })

  it('records optional dependency versions in cache manifest', async () => {
    process.env.npm_config_user_agent = 'npm'
    const {installOptionalDependencies, resolveOptionalInstallRoot} =
      await import('../index')
    const installRoot = resolveOptionalInstallRoot()
    seedInstalledDependency(installRoot, 'react-refresh')
    seedInstalledDependency(installRoot, '@rspack/plugin-react-refresh')

    await installOptionalDependencies('React', [
      'react-refresh',
      '@rspack/plugin-react-refresh'
    ])

    const manifestPath = path.join(resolveOptionalInstallRoot(), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(pkg.optionalDependencies?.['react-refresh']).toBe('0.18.0')
    expect(pkg.optionalDependencies?.['@rspack/plugin-react-refresh']).toBe(
      '1.6.0'
    )
  })

  it('runs a single command for single-package install', async () => {
    process.env.npm_config_user_agent = 'npm'
    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies, resolveOptionalInstallRoot} =
      await import('../index')
    seedInstalledDependency(resolveOptionalInstallRoot(), 'postcss')

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('runs root relink for multi-package install', async () => {
    process.env.npm_config_user_agent = 'pnpm'
    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies, resolveOptionalInstallRoot} =
      await import('../index')
    const installRoot = resolveOptionalInstallRoot()
    seedInstalledDependency(installRoot, 'vue-loader')
    seedInstalledDependency(installRoot, '@vue/compiler-sfc')
    seedInstalledDependency(installRoot, 'vue')

    await installOptionalDependencies('Vue', [
      'vue-loader',
      '@vue/compiler-sfc',
      'vue'
    ])

    expect(spawn).toHaveBeenCalledTimes(2)
    const relinkArgs = Array.isArray(spawn.mock.calls[1]?.[1])
      ? spawn.mock.calls[1][1].join(' ')
      : ''
    expect(relinkArgs).toContain('install')
  })

  it('recovers from partial install by topping up missing dependency', async () => {
    process.env.npm_config_user_agent = 'pnpm'
    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies, resolveOptionalInstallRoot} =
      await import('../index')
    const installRoot = resolveOptionalInstallRoot()
    seedInstalledDependency(installRoot, '@rspack/plugin-react-refresh')

    let callIndex = 0
    spawn.mockImplementation(() => {
      if (callIndex === 2) {
        seedInstalledDependency(installRoot, 'react-refresh')
      }
      callIndex += 1
      return createSpawn({exitCode: 0})
    })

    const result = await installOptionalDependencies('React', [
      'react-refresh',
      '@rspack/plugin-react-refresh'
    ])

    expect(result).toBe(true)
    expect(callIndex).toBeGreaterThanOrEqual(3)
  })

  it('recreates npm install root after incremental update leaves packages missing', async () => {
    process.env.npm_config_user_agent = 'npm'
    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies, resolveOptionalInstallRoot} =
      await import('../index')
    const installRoot = resolveOptionalInstallRoot()
    seedInstalledDependency(installRoot, 'postcss-loader')

    let callIndex = 0
    spawn.mockImplementation(() => {
      if (callIndex === 0) {
        seedInstalledDependency(installRoot, '@rspack/plugin-react-refresh')
      }
      if (callIndex === 1) {
        seedInstalledDependency(installRoot, '@rspack/plugin-react-refresh')
        seedInstalledDependency(installRoot, 'react-refresh')
      }
      callIndex += 1
      return createSpawn({exitCode: 0})
    })

    const result = await installOptionalDependencies('React', [
      'react-refresh',
      '@rspack/plugin-react-refresh'
    ])

    expect(result).toBe(true)
    expect(callIndex).toBe(2)
  })

  it('does not fallback on windows when primary manager is npm', async () => {
    setPlatform('win32')
    process.env.npm_config_user_agent = 'npm'
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'
    const {spawn} = (await import('child_process')) as any
    spawn.mockImplementationOnce(() => createSpawn({exitCode: 1}))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const {installOptionalDependencies} = await import('../index')
    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(
      errorSpy.mock.calls.map((call) => String(call?.[0] || '')).join('\n')
    ).toContain('Failed to install dependencies')
    errorSpy.mockRestore()
  })
})
