import {describe, it, expect, vi, beforeEach} from 'vitest'

const callOrder: string[] = []

vi.mock('../steps/create-directory', () => ({
  createDirectory: async () => {
    callOrder.push('createDirectory')
  }
}))
vi.mock('../steps/import-external-template', () => ({
  importExternalTemplate: async () => {
    callOrder.push('importExternalTemplate')
  }
}))
vi.mock('../steps/write-package-json', () => ({
  overridePackageJson: async () => {
    callOrder.push('overridePackageJson')
  }
}))
vi.mock('../steps/install-dependencies', () => ({
  installDependencies: async () => {
    callOrder.push('installDependencies')
  }
}))
vi.mock('../steps/install-internal-deps', () => ({
  installInternalDependencies: async () => {
    callOrder.push('installInternalDependencies')
  }
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

describe('create install order', () => {
  beforeEach(() => {
    callOrder.length = 0
    vi.resetModules()
  })

  it('installs project deps before internal deps when install=true', async () => {
    const {extensionCreate} = await import('../module')
    await extensionCreate('demo-project', {
      template: 'init',
      install: true
    })

    const installDepsIndex = callOrder.indexOf('installDependencies')
    const internalDepsIndex = callOrder.indexOf('installInternalDependencies')

    expect(installDepsIndex).toBeGreaterThan(-1)
    expect(internalDepsIndex).toBeGreaterThan(-1)
    expect(installDepsIndex).toBeLessThan(internalDepsIndex)
  })

  it('skips internal deps when install=false', async () => {
    const {extensionCreate} = await import('../module')
    await extensionCreate('demo-project', {
      template: 'init',
      install: false
    })

    expect(callOrder.includes('installDependencies')).toBe(false)
    expect(callOrder.includes('installInternalDependencies')).toBe(false)
  })
})
