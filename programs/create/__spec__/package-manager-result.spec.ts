import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../steps/create-directory', () => ({
  createDirectory: async () => undefined
}))
vi.mock('../steps/import-external-template', () => ({
  importExternalTemplate: async () => undefined
}))
vi.mock('../steps/write-package-json', () => ({
  overridePackageJson: async () => undefined
}))
vi.mock('../steps/write-deno-jsonc', () => ({
  writeDenoJsonc: async () => undefined
}))
vi.mock('../steps/install-dependencies', () => ({
  installDependencies: async () => undefined
}))
vi.mock('../steps/install-internal-deps', () => ({
  installInternalDependencies: async () => undefined
}))
vi.mock('../steps/write-readme-file', () => ({
  writeReadmeFile: async () => undefined
}))
vi.mock('../steps/write-manifest-json', () => ({
  writeManifestJson: async () => undefined
}))
vi.mock('../steps/initialize-git-repository', () => ({
  initializeGitRepository: async () => undefined
}))
vi.mock('../steps/write-gitignore', () => ({
  writeGitignore: async () => undefined
}))
vi.mock('../steps/setup-built-in-tests', () => ({
  setupBuiltInTests: async () => undefined
}))
vi.mock('../steps/generate-extension-types', () => ({
  generateExtensionTypes: async () => undefined
}))
vi.mock('../lib/utils', () => ({
  isTypeScriptTemplate: () => false
}))

const silentLogger = {log: () => undefined, error: () => undefined}

const PM_ENV_VARS = [
  'npm_config_user_agent',
  'npm_execpath',
  'NPM_EXEC_PATH',
  'BUN_INSTALL'
]

describe('resolveScaffoldPackageManager', () => {
  const clearPmEnv = () => {
    for (const key of PM_ENV_VARS) vi.stubEnv(key, '')
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('reports the package manager from the invoking environment', async () => {
    clearPmEnv()
    vi.stubEnv('npm_config_user_agent', 'pnpm/9.9.0 npm/? node/v20.0.0')
    const {resolveScaffoldPackageManager} = await import(
      '../lib/package-manager'
    )
    expect(resolveScaffoldPackageManager()).toBe('pnpm')
  })

  it('falls back to npm when no package manager is in the environment', async () => {
    clearPmEnv()
    const {resolveScaffoldPackageManager} = await import(
      '../lib/package-manager'
    )
    expect(resolveScaffoldPackageManager()).toBe('npm')
  })
})

describe('CreateResult.packageManager', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('exposes the resolved package manager on the result', async () => {
    vi.stubEnv('npm_config_user_agent', 'bun/1.1.0 npm/? node/v20.0.0')

    const [{extensionCreate}, {resolveScaffoldPackageManager}] =
      await Promise.all([import('../module'), import('../lib/package-manager')])

    const result = await extensionCreate('demo-project', {
      install: false,
      logger: silentLogger
    })

    expect(result.packageManager).toBe('bun')
    expect(result.packageManager).toBe(resolveScaffoldPackageManager())
  })
})
