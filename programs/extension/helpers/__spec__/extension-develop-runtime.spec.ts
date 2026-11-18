import fs from 'node:fs'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {internalErrorEnvelope} from '../cli-failure'
import {getCliPackageJson} from '../cli-package-json'
import {
  loadExtensionDevelopBridgeModule,
  loadExtensionDevelopModule,
  loadExtensionDevelopPreviewModule,
  resolveExtensionDevelopRoot,
  resolveExtensionDevelopVersion
} from '../extension-develop-runtime'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'

const makeTempFolder = trackTempFolders()

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

const CLI_VERSION = String(getCliPackageJson().version)

const LOADERS = [
  ['the full module', loadExtensionDevelopModule],
  ['the preview entry', loadExtensionDevelopPreviewModule],
  ['the bridge entry', loadExtensionDevelopBridgeModule]
] as const

// A stand-in engine with the three entries a command can load.
function writeEngine(root: string, manifest: string, label: string) {
  fs.mkdirSync(path.join(root, 'dist'), {recursive: true})
  fs.writeFileSync(path.join(root, 'package.json'), manifest)

  for (const entry of ['module', 'preview', 'bridge']) {
    fs.writeFileSync(
      path.join(root, 'dist', `${entry}.mjs`),
      `export const extensionDev = ${JSON.stringify(label)}\n`
    )
  }
}

function engineManifest(version: string): string {
  return JSON.stringify({name: 'extension-develop', version})
}

// An install as a package manager lays it out: the CLI and, beside it, the
// engine Node resolves for it. The real path, as Node reports a resolution.
function installBesideTheCli(manifest: string) {
  const consumer = fs.realpathSync(makeTempFolder('extjs-develop-install-'))
  const modules = path.join(consumer, 'node_modules')
  const startDir = path.join(modules, 'extension', 'dist')
  const engineRoot = path.join(modules, 'extension-develop')

  fs.mkdirSync(startDir, {recursive: true})
  writeEngine(engineRoot, manifest, 'installed')

  return {startDir, engineRoot}
}

describe('extension-develop runtime resolution', () => {
  const previousDevelopRoot = process.env.EXTENSION_DEVELOP_ROOT
  const previousCreateRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT

  afterEach(() => {
    if (previousDevelopRoot === undefined) {
      delete process.env.EXTENSION_DEVELOP_ROOT
    } else {
      process.env.EXTENSION_DEVELOP_ROOT = previousDevelopRoot
    }

    if (previousCreateRoot === undefined) {
      delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
    } else {
      process.env.EXTENSION_CREATE_DEVELOP_ROOT = previousCreateRoot
    }
  })

  it('prefers the workspace extension-develop root over an env override', async () => {
    const root = makeTempFolder('extjs-develop-runtime-')
    const workspaceDevelopRoot = path.join(root, 'programs', 'develop')
    const envDevelopRoot = path.join(root, 'vendor', 'extension-develop')

    writeJson(path.join(workspaceDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '9.9.9'
    })

    fs.mkdirSync(path.join(workspaceDevelopRoot, 'dist'), {recursive: true})
    fs.writeFileSync(
      path.join(workspaceDevelopRoot, 'dist', 'module.mjs'),
      'export const extensionDev = "workspace"\n'
    )

    writeJson(path.join(envDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '1.0.0'
    })

    fs.mkdirSync(path.join(envDevelopRoot, 'dist'), {recursive: true})
    fs.writeFileSync(
      path.join(envDevelopRoot, 'dist', 'module.mjs'),
      'export const extensionDev = "env"\n'
    )

    process.env.EXTENSION_DEVELOP_ROOT = envDevelopRoot

    const startDir = path.join(root, 'programs', 'cli', 'dist')
    fs.mkdirSync(startDir, {recursive: true})

    expect(resolveExtensionDevelopRoot(startDir)).toBe(workspaceDevelopRoot)
    const mod = await loadExtensionDevelopModule<{extensionDev: string}>(
      startDir
    )
    expect(mod.extensionDev).toBe('workspace')
    expect(resolveExtensionDevelopVersion(startDir, '0.0.0')).toBe('9.9.9')
  })

  it('does not escape node_modules to claim an outer workspace runtime', async () => {
    const root = makeTempFolder('extjs-develop-runtime-installed-')
    const outerWorkspaceDevelopRoot = path.join(root, 'programs', 'develop')
    const envDevelopRoot = path.join(
      root,
      'consumer',
      'node_modules',
      'extension-develop'
    )
    const startDir = path.join(
      root,
      'consumer',
      'node_modules',
      'extension',
      'dist'
    )

    writeJson(path.join(outerWorkspaceDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '9.9.9'
    })

    writeJson(path.join(envDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '1.2.3'
    })

    fs.mkdirSync(path.join(envDevelopRoot, 'dist'), {recursive: true})
    fs.writeFileSync(
      path.join(envDevelopRoot, 'dist', 'module.mjs'),
      'export const extensionDev = "env"\n'
    )

    fs.mkdirSync(startDir, {recursive: true})

    process.env.EXTENSION_DEVELOP_ROOT = envDevelopRoot

    expect(resolveExtensionDevelopRoot(startDir)).toBe(envDevelopRoot)
    const mod = await loadExtensionDevelopModule<{extensionDev: string}>(
      startDir
    )
    expect(mod.extensionDev).toBe('env')
  })

  it('fails loudly when the workspace runtime exists but is not built', async () => {
    const root = makeTempFolder('extjs-develop-runtime-missing-')
    const workspaceDevelopRoot = path.join(root, 'programs', 'develop')
    const startDir = path.join(root, 'programs', 'cli', 'dist')

    writeJson(path.join(workspaceDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '9.9.9'
    })

    fs.mkdirSync(startDir, {recursive: true})

    await expect(loadExtensionDevelopModule(startDir)).rejects.toThrow(
      /Run `pnpm --filter extension-develop compile`/
    )
  })

  it.each([
    ['the full module', loadExtensionDevelopModule],
    ['the preview entry', loadExtensionDevelopPreviewModule],
    ['the bridge entry', loadExtensionDevelopBridgeModule]
  ])('codes an unbuilt workspace runtime as E_RUNTIME_NOT_FOUND for %s', async (_entry, load) => {
    const root = makeTempFolder('extjs-develop-runtime-coded-')
    const startDir = path.join(root, 'programs', 'cli', 'dist')

    writeJson(path.join(root, 'programs', 'develop', 'package.json'), {
      name: 'extension-develop',
      version: '9.9.9'
    })

    fs.mkdirSync(startDir, {recursive: true})

    const error = await load(startDir).catch((caught: unknown) => caught)

    expect(error).toMatchObject({code: 'E_RUNTIME_NOT_FOUND'})
    expect(internalErrorEnvelope(error, 'build')).toMatchObject({
      ok: false,
      status: 'failed',
      error: {code: 'E_RUNTIME_NOT_FOUND'}
    })
  })

  it.each(
    LOADERS
  )('loads %s of the engine installed beside the CLI at the same version', async (_entry, load) => {
    const {startDir, engineRoot} = installBesideTheCli(
      engineManifest(CLI_VERSION)
    )

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')

    expect(resolveExtensionDevelopRoot(startDir)).toBe(engineRoot)
    await expect(
      (load as typeof loadExtensionDevelopBridgeModule)(startDir)
    ).resolves.toMatchObject({extensionDev: 'installed'})
  })

  it('loads an installed engine of another version', async () => {
    const {startDir} = installBesideTheCli(engineManifest('0.0.1'))

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')

    // Pins today's behavior.
    await expect(
      loadExtensionDevelopModule<{extensionDev: string}>(startDir)
    ).resolves.toMatchObject({extensionDev: 'installed'})
  })

  it.each([
    ['is not JSON', '{"name": "extension-develop", "version": '],
    ['names another package', JSON.stringify({name: 'left-pad', version: '1'})]
  ])('finds no runtime when the manifest of the installed engine %s', async (_case, manifest) => {
    const {startDir} = installBesideTheCli(manifest)

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')

    expect(() => resolveExtensionDevelopRoot(startDir)).toThrow(
      expect.objectContaining({
        code: 'E_RUNTIME_NOT_FOUND',
        message: 'Unable to locate the extension-develop runtime.'
      })
    )
    await expect(loadExtensionDevelopModule(startDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_NOT_FOUND'
    })
  })
})
