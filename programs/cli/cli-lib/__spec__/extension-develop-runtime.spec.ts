import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadExtensionDevelopModule,
  resolveExtensionDevelopRoot,
  resolveExtensionDevelopVersion
} from '../extension-develop-runtime'

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
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

  it('prefers the workspace extension-develop root over an env override', () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-develop-runtime-')
    )
    const workspaceDevelopRoot = path.join(root, 'programs', 'develop')
    const envDevelopRoot = path.join(root, 'vendor', 'extension-develop')

    writeJson(path.join(workspaceDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '9.9.9'
    })
    fs.mkdirSync(path.join(workspaceDevelopRoot, 'dist'), {recursive: true})
    fs.writeFileSync(
      path.join(workspaceDevelopRoot, 'dist', 'module.cjs'),
      'module.exports = {extensionDev: "workspace"}\n'
    )

    writeJson(path.join(envDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '1.0.0'
    })
    fs.mkdirSync(path.join(envDevelopRoot, 'dist'), {recursive: true})
    fs.writeFileSync(
      path.join(envDevelopRoot, 'dist', 'module.cjs'),
      'module.exports = {extensionDev: "env"}\n'
    )

    process.env.EXTENSION_DEVELOP_ROOT = envDevelopRoot

    const startDir = path.join(root, 'programs', 'cli', 'dist')
    fs.mkdirSync(startDir, {recursive: true})

    expect(resolveExtensionDevelopRoot(startDir)).toBe(workspaceDevelopRoot)
    expect(
      loadExtensionDevelopModule<{extensionDev: string}>(startDir)
    ).toEqual({
      extensionDev: 'workspace'
    })
    expect(resolveExtensionDevelopVersion(startDir, '0.0.0')).toBe('9.9.9')
  })

  it('fails loudly when the workspace runtime exists but is not built', () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-develop-runtime-missing-')
    )
    const workspaceDevelopRoot = path.join(root, 'programs', 'develop')
    const startDir = path.join(root, 'programs', 'cli', 'dist')

    writeJson(path.join(workspaceDevelopRoot, 'package.json'), {
      name: 'extension-develop',
      version: '9.9.9'
    })
    fs.mkdirSync(startDir, {recursive: true})

    expect(() => loadExtensionDevelopModule(startDir)).toThrow(
      /Run `pnpm --filter extension-develop compile`/
    )
  })
})
