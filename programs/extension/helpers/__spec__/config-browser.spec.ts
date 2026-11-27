import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {resolveConfigBrowser} from '../config-browser'
import {loadExtensionDevelopModule} from '../extension-develop-runtime'

const makeTempFolder = trackTempFolders()

// The config names its browser from an env value, so the answer says which
// env files the probe read.
function projectWith(envFiles: Record<string, string>): string {
  const dir = makeTempFolder('extjs-config-browser-')

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"probe","type":"module"}'
  )

  fs.writeFileSync(
    path.join(dir, 'extension.config.js'),
    'const browser = process.env.EXTENSION_PUBLIC_PROBE_BROWSER\n' +
      'export default {commands: {dev: {browser}, build: {browser}, start: {browser}}}\n'
  )

  for (const [name, browser] of Object.entries(envFiles)) {
    fs.writeFileSync(
      path.join(dir, name),
      `EXTENSION_PUBLIC_PROBE_BROWSER=${browser}\n`
    )
  }

  return dir
}

// The probe runs before any browser is known, so it is the one config load
// that names none of its own: it reads as the stock browser would.
describe('the probe that finds the browser in the config', () => {
  it('finds a browser the mode env file of the command names', async () => {
    const dir = projectWith({
      '.env.development': 'firefox',
      '.env.production': 'edge'
    })

    await expect(resolveConfigBrowser(dir, 'dev')).resolves.toBe('firefox')
    await expect(resolveConfigBrowser(dir, 'build')).resolves.toBe('edge')
    await expect(resolveConfigBrowser(dir, 'start')).resolves.toBe('edge')
  })

  it('reads the env files of the mode a build was asked for', async () => {
    const dir = projectWith({
      '.env.development': 'firefox',
      '.env.production': 'edge'
    })

    await expect(
      resolveConfigBrowser(dir, 'build', undefined, 'development')
    ).resolves.toBe('firefox')
  })

  it('reads the env files of the stock browser, as the engine does', async () => {
    const dir = projectWith({
      '.env.production': 'edge',
      '.env.chromium': 'firefox'
    })

    await expect(resolveConfigBrowser(dir, 'build')).resolves.toBe('firefox')
  })

  it('answers unset for a config that names no browser', async () => {
    await expect(
      resolveConfigBrowser(projectWith({}), 'dev')
    ).resolves.toBeUndefined()
  })
})

// A fresh checkout has no node_modules, and this config resolves a declared
// package where the file loads, so it only reads once the install has run.
function projectResolvingADependency(): string {
  const dir = makeTempFolder('extjs-config-browser-')

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"probe","type":"module","dependencies":{"probe-dep":"1.0.0"}}'
  )

  fs.writeFileSync(
    path.join(dir, 'extension.config.js'),
    "import {createRequire} from 'node:module'\n" +
      "createRequire(import.meta.url).resolve('probe-dep')\n" +
      "export default {commands: {build: {browser: 'firefox'}}}\n"
  )

  return dir
}

function putDependencyInPlace(dir: string) {
  const dependency = path.join(dir, 'node_modules', 'probe-dep')

  fs.mkdirSync(dependency, {recursive: true})
  fs.writeFileSync(
    path.join(dependency, 'package.json'),
    '{"name":"probe-dep","version":"1.0.0","main":"index.js"}'
  )

  fs.writeFileSync(path.join(dependency, 'index.js'), 'module.exports = 1\n')
}

describe('the probe in a folder whose packages are not installed yet', () => {
  // The real engine loads the config, so Node's own module cache is in play.
  const engineInstalling =
    (installs: string[], installed: boolean) => async () => {
      const develop = await loadExtensionDevelopModule()

      return {
        loadCommandConfig: develop.loadCommandConfig,
        installMissingProjectDependencies: async (projectPath: string) => {
          installs.push(projectPath)
          if (installed) putDependencyInPlace(projectPath)

          return installed
        }
      }
    }

  it('installs, then finds the browser the config names', async () => {
    const dir = projectResolvingADependency()
    const installs: string[] = []

    await expect(
      resolveConfigBrowser(dir, 'build', engineInstalling(installs, true))
    ).resolves.toBe('firefox')

    expect(installs).toEqual([dir])
  })

  it('answers unset without installing when the run installs nothing', async () => {
    const dir = projectResolvingADependency()
    const installs: string[] = []

    await expect(
      resolveConfigBrowser(
        dir,
        'build',
        engineInstalling(installs, true),
        undefined,
        false
      )
    ).resolves.toBeUndefined()

    expect(installs).toEqual([])
  })

  it('answers unset when there was nothing to install', async () => {
    const dir = projectResolvingADependency()
    const installs: string[] = []

    await expect(
      resolveConfigBrowser(dir, 'build', engineInstalling(installs, false))
    ).resolves.toBeUndefined()

    expect(installs).toEqual([dir])
  })
})
