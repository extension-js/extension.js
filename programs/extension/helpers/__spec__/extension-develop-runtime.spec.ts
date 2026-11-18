import fs from 'node:fs'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {internalErrorEnvelope} from '../cli-failure'
import {getCliPackageJson} from '../cli-package-json'
import {developVersionMismatch, localDevelopVersionDiffers} from '../messages'
import {stripChannelPrefix} from '../messaging'
import {telemetryFailureCode} from '../telemetry-cli'
import {
  loadExtensionDevelopBridgeModule,
  loadExtensionDevelopModule,
  loadExtensionDevelopPreviewModule,
  reinstallCommandFor,
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
function writeEngine(root: string, manifest: string, entrySource: string) {
  fs.mkdirSync(path.join(root, 'dist'), {recursive: true})
  fs.writeFileSync(path.join(root, 'package.json'), manifest)

  for (const entry of ['module', 'preview', 'bridge']) {
    fs.writeFileSync(path.join(root, 'dist', `${entry}.mjs`), entrySource)
  }
}

const LOADS = 'export const extensionDev = "stand-in"\n'
// An entry that gives itself away, for a refusal that has to come first.
const MUST_NOT_BE_IMPORTED = 'throw new Error("the engine was imported")\n'

function engineManifest(version: string): string {
  return JSON.stringify({name: 'extension-develop', version})
}

// An install as a package manager lays it out: the CLI and, beside it, the
// engine Node resolves for it. The real path, as Node reports a resolution.
function installBesideTheCli(manifest: string, entrySource: string = LOADS) {
  const consumer = fs.realpathSync(makeTempFolder('extjs-develop-install-'))
  const modules = path.join(consumer, 'node_modules')
  const startDir = path.join(modules, 'extension', 'dist')
  const engineRoot = path.join(modules, 'extension-develop')

  fs.mkdirSync(startDir, {recursive: true})
  // A project install, so the refusal names the project's own command.
  writeJson(path.join(consumer, 'package.json'), {name: 'consumer'})
  writeEngine(engineRoot, manifest, entrySource)

  return {startDir, engineRoot}
}

// A checkout of the engine somewhere else, as EXTENSION_DEVELOP_ROOT names it.
function localEngine(version: string) {
  const engineRoot = path.join(
    fs.realpathSync(makeTempFolder('extjs-develop-local-')),
    'extension-develop'
  )

  writeEngine(engineRoot, engineManifest(version), LOADS)

  return engineRoot
}

// The folder of an installed CLI with no stand-in engine beside it.
function installedCliFolder() {
  const startDir = path.join(
    fs.realpathSync(makeTempFolder('extjs-develop-cli-')),
    'node_modules',
    'extension',
    'dist'
  )

  fs.mkdirSync(startDir, {recursive: true})

  return startDir
}

describe('extension-develop runtime resolution', () => {
  const previousDevelopRoot = process.env.EXTENSION_DEVELOP_ROOT
  const previousCreateRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT

  afterEach(() => {
    vi.restoreAllMocks()

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

    // The engine beside the CLI is its install, so the version has to match.
    writeJson(path.join(envDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: CLI_VERSION
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')

    expect(resolveExtensionDevelopRoot(startDir)).toBe(engineRoot)
    await expect(
      (load as typeof loadExtensionDevelopBridgeModule)(startDir)
    ).resolves.toMatchObject({extensionDev: 'stand-in'})

    expect(warn).not.toHaveBeenCalled()
  })

  it.each(
    LOADERS
  )('refuses %s of an installed engine of another version before importing it', async (_entry, load) => {
    const {startDir, engineRoot} = installBesideTheCli(
      engineManifest('0.0.1'),
      MUST_NOT_BE_IMPORTED
    )
    const refusal = developVersionMismatch(CLI_VERSION, '0.0.1', engineRoot)

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')

    const error = await load(startDir).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'E_RUNTIME_NOT_FOUND',
      message: refusal
    })

    expect(internalErrorEnvelope(error, 'build')).toEqual({
      schema: 1,
      ok: false,
      command: 'build',
      status: 'failed',
      value: null,
      error: {
        code: 'E_RUNTIME_NOT_FOUND',
        message: stripChannelPrefix(refusal),
        name: 'Error'
      },
      warnings: []
    })

    expect(telemetryFailureCode((error as {code?: unknown}).code)).toBe(
      'E_RUNTIME_NOT_FOUND'
    )
  })

  it('says both versions, where the engine is and the one command that fixes it', () => {
    expect(
      stripChannelPrefix(
        developVersionMismatch('4.1.42-canary.3', '4.1.41', '/app/engine')
      )
    ).toBe(
      'extension@4.1.42-canary.3 found extension-develop@4.1.41 at /app/engine. ' +
        'The two run together only at the same version.\n' +
        'Reinstall so both are 4.1.42-canary.3: npm install extension@4.1.42-canary.3\n' +
        'To run a local engine on purpose, set EXTENSION_DEVELOP_ROOT to its folder.'
    )
  })

  it('reads a prerelease of the same release as another version', async () => {
    const {startDir} = installBesideTheCli(
      engineManifest(`${CLI_VERSION}-canary.3`),
      MUST_NOT_BE_IMPORTED
    )

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')

    await expect(loadExtensionDevelopModule(startDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_NOT_FOUND'
    })
  })

  it('refuses an installed engine whose manifest has no version', async () => {
    const {startDir, engineRoot} = installBesideTheCli(
      JSON.stringify({name: 'extension-develop'}),
      MUST_NOT_BE_IMPORTED
    )

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')

    await expect(loadExtensionDevelopModule(startDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_NOT_FOUND',
      message: developVersionMismatch(CLI_VERSION, 'unknown', engineRoot)
    })
  })

  // The CLI writes the root it found to EXTENSION_DEVELOP_ROOT at startup, so
  // the variable alone does not say the user chose a local engine.
  it('still refuses once the CLI itself has written the installed root to EXTENSION_DEVELOP_ROOT', async () => {
    const {startDir, engineRoot} = installBesideTheCli(
      engineManifest('0.0.1'),
      MUST_NOT_BE_IMPORTED
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    Reflect.deleteProperty(process.env, 'EXTENSION_DEVELOP_ROOT')
    resolveExtensionDevelopRoot(startDir)

    expect(process.env.EXTENSION_DEVELOP_ROOT).toBe(engineRoot)
    await expect(loadExtensionDevelopModule(startDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_NOT_FOUND'
    })

    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once across loads when EXTENSION_DEVELOP_ROOT names a local engine of another version', async () => {
    const startDir = installedCliFolder()
    const engineRoot = localEngine('0.0.1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    process.env.EXTENSION_DEVELOP_ROOT = engineRoot

    for (const [, load] of LOADERS) {
      await expect(
        (load as typeof loadExtensionDevelopBridgeModule)(startDir)
      ).resolves.toMatchObject({extensionDev: 'stand-in'})
    }

    await loadExtensionDevelopModule(startDir)

    expect(warn.mock.calls).toEqual([
      [localDevelopVersionDiffers(CLI_VERSION, '0.0.1', engineRoot)]
    ])

    expect(stripChannelPrefix(String(warn.mock.calls[0][0]))).toBe(
      `EXTENSION_DEVELOP_ROOT runs extension-develop@0.0.1 from ${engineRoot} ` +
        `with extension@${CLI_VERSION}. The versions differ, so a failure here may come from the pair.`
    )
  })

  it('says nothing when EXTENSION_DEVELOP_ROOT names a local engine of the same version', async () => {
    const startDir = installedCliFolder()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    process.env.EXTENSION_DEVELOP_ROOT = localEngine(CLI_VERSION)

    await expect(
      loadExtensionDevelopModule<{extensionDev: string}>(startDir)
    ).resolves.toMatchObject({extensionDev: 'stand-in'})

    expect(warn).not.toHaveBeenCalled()
  })

  // The monorepo and a linked CLI run the engine of the same checkout.
  it('does not compare versions for the engine of the checkout the CLI runs from', async () => {
    const root = fs.realpathSync(makeTempFolder('extjs-develop-checkout-'))
    const startDir = path.join(root, 'programs', 'extension', 'dist')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    fs.mkdirSync(startDir, {recursive: true})
    writeEngine(
      path.join(root, 'programs', 'develop'),
      engineManifest('0.0.1'),
      LOADS
    )

    for (const [, load] of LOADERS) {
      await expect(
        (load as typeof loadExtensionDevelopBridgeModule)(startDir)
      ).resolves.toMatchObject({extensionDev: 'stand-in'})
    }

    expect(warn).not.toHaveBeenCalled()
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
      code: 'E_RUNTIME_NOT_FOUND',
      message: 'Unable to locate the extension-develop runtime.'
    })
  })
})

describe('the command that puts a matching engine back', () => {
  const VERSION = '4.1.42'
  const engineIn = (...parts: string[]) =>
    path.join(...parts, 'node_modules', 'extension-develop')

  it.each([
    ['pnpm-lock.yaml', `pnpm add extension@${VERSION}`],
    ['yarn.lock', `yarn add extension@${VERSION}`],
    ['bun.lock', `bun add extension@${VERSION}`],
    ['bun.lockb', `bun add extension@${VERSION}`],
    ['deno.lock', `deno add npm:extension@${VERSION}`],
    ['package-lock.json', `npm install extension@${VERSION}`]
  ])('names the manager of a project with %s', (lockfile, command) => {
    const project = makeTempFolder('extjs-reinstall-')

    writeJson(path.join(project, 'package.json'), {name: 'probe'})
    fs.writeFileSync(path.join(project, lockfile), '')

    expect(reinstallCommandFor(engineIn(project), VERSION)).toBe(command)
  })

  it('reads the project above a pnpm store path', () => {
    const project = makeTempFolder('extjs-reinstall-')

    writeJson(path.join(project, 'package.json'), {name: 'probe'})
    fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), '')

    const engineRoot = path.join(
      project,
      'node_modules',
      '.pnpm',
      `extension-develop@${VERSION}`,
      'node_modules',
      'extension-develop'
    )

    expect(reinstallCommandFor(engineRoot, VERSION)).toBe(
      `pnpm add extension@${VERSION}`
    )
  })

  it('falls back to npm for a project with no lockfile', () => {
    const project = makeTempFolder('extjs-reinstall-')

    writeJson(path.join(project, 'package.json'), {name: 'probe'})

    expect(reinstallCommandFor(engineIn(project), VERSION)).toBe(
      `npm install extension@${VERSION}`
    )
  })

  it.each([
    [['home', '.npm', '_npx', 'a1b2'], `npx extension@${VERSION}`],
    [['cache', 'pnpm', 'dlx', 'a1b2', 'pkg'], `pnpm dlx extension@${VERSION}`],
    [['tmp', 'bunx-501-extension@latest'], `bunx extension@${VERSION}`],
    [['home', '.bun', 'install', 'global'], `bun add -g extension@${VERSION}`],
    [['data', 'pnpm', 'global', '5'], `pnpm add -g extension@${VERSION}`],
    [['config', 'yarn', 'global'], `yarn global add extension@${VERSION}`]
  ])('names the runner or global install under %j', (parts, command) => {
    const root = makeTempFolder('extjs-reinstall-')

    expect(reinstallCommandFor(engineIn(root, ...parts), VERSION)).toBe(command)
  })

  it('reads a folder with no package.json above node_modules as a global npm install', () => {
    const prefix = makeTempFolder('extjs-reinstall-')

    expect(
      reinstallCommandFor(
        path.join(
          prefix,
          'lib',
          'node_modules',
          'extension',
          'node_modules',
          'extension-develop'
        ),
        VERSION
      )
    ).toBe(`npm install -g extension@${VERSION}`)
  })

  it('puts the command in the refusal', () => {
    expect(
      stripChannelPrefix(
        developVersionMismatch(
          VERSION,
          '4.1.41',
          '/app/engine',
          `pnpm add extension@${VERSION}`
        )
      )
    ).toContain(
      `Reinstall so both are ${VERSION}: pnpm add extension@${VERSION}\n`
    )
  })
})
