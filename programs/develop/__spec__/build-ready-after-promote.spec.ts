import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildSummaryPath, readyContractPath} from '../lib/session-paths'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const promote = vi.hoisted(() => ({fails: false}))

vi.mock('../lib/atomic-dist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/atomic-dist')>()

  return {
    ...actual,
    promoteStagingDist: (staging: string, dist: string) => {
      if (promote.fails) throw new Error('rename refused by the spec')

      return actual.promoteStagingDist(staging, dist)
    }
  }
})

const zip = vi.hoisted(() => ({fails: false}))

vi.mock('../plugin-compilation/zip-artifacts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../plugin-compilation/zip-artifacts')>()

  return {
    ...actual,
    getZipFailures: (carrier: unknown) =>
      zip.fails
        ? [
            {
              kind: 'dist' as const,
              path: '/out/probe-chrome.zip',
              reason: 'ENOSPC: no space left on device'
            }
          ]
        : actual.getZipFailures(carrier)
  }
})

const tempFolder = trackTempFolders()
const BROWSER = 'chrome'

// A plugin of the project's own, tapped after the engine's: it reads what a
// reader of ready.json would find at the moment the compile reports done.
const PROBE_CONFIG = [
  "const fs = require('node:fs')",
  "const path = require('node:path')",
  'module.exports = {',
  '  config: (config) => {',
  '    config.plugins.push({',
  '      apply(compiler) {',
  "        compiler.hooks.done.tap('ready-probe', () => {",
  `          const ready = path.join(__dirname, 'dist', 'extension-js', '${BROWSER}', 'ready.json')`,
  `          const manifest = path.join(__dirname, 'dist', '${BROWSER}', 'manifest.json')`,
  '          const contract = JSON.parse(fs.readFileSync(ready))',
  "          fs.writeFileSync(path.join(__dirname, 'probe.json'), JSON.stringify({",
  '            contract,',
  '            built: fs.existsSync(manifest)',
  '          }))',
  '        })',
  '      }',
  '    })',
  '    return config',
  '  }',
  '}',
  ''
].join('\n')

function project() {
  const root = fs.realpathSync(tempFolder('extjs-ready-after-promote-'))

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'ready-after-promote',
      version: '0.0.0'
    })
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Ready after promote',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<html><body>popup</body></html>\n'
  )

  fs.writeFileSync(path.join(root, 'extension.config.js'), PROBE_CONFIG)

  return root
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

async function build(root: string, options: Record<string, unknown> = {}) {
  return buildProject(root, {
    browser: BROWSER,
    mode: 'production',
    exitOnError: false,
    ...options
  })
}

beforeEach(() => {
  promote.fails = false
  zip.fails = false
  vi.stubEnv('VITEST', 'true')
  vi.stubEnv('EXTENSION_AUTHOR_MODE', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('when a build says ready', () => {
  it('holds ready until the output is where the contract says it is', async () => {
    const root = project()

    await build(root)

    const atCompileDone = readJson(path.join(root, 'probe.json'))

    // The compile is over and the output still sits in staging.
    expect(atCompileDone.built).toBe(false)
    expect(atCompileDone.contract.status).toBe('starting')
    expect(typeof atCompileDone.contract.compiledAt).toBe('string')

    const ready = readJson(readyContractPath(root, BROWSER))

    expect(ready.status).toBe('ready')
    expect(ready.command).toBe('build')
    expect(ready.distPath).toBe(path.join(root, 'dist', BROWSER))
    expect(fs.existsSync(path.join(ready.distPath, 'manifest.json'))).toBe(true)
    expect(typeof ready.extensionId).toBe('string')
    expect(fs.existsSync(buildSummaryPath(root, BROWSER))).toBe(true)

    // The command's write changes the status and adds the id of the folder
    // now in place. Every field the compile wrote is still there, unchanged.
    const {status, ts, extensionId, extensionIdSource, ...kept} = ready
    const {status: heldStatus, ts: heldTs, ...held} = atCompileDone.contract

    expect(kept).toEqual(held)
  }, 120_000)

  it('never says ready over the previous build while a rebuild compiles', async () => {
    const root = project()

    await build(root)

    const first = readJson(readyContractPath(root, BROWSER))

    fs.writeFileSync(
      path.join(root, 'popup.html'),
      '<html><body>popup, edited</body></html>\n'
    )

    await build(root)

    const atCompileDone = readJson(path.join(root, 'probe.json'))
    const second = readJson(readyContractPath(root, BROWSER))

    // The folder in place then is the first build, so ready would be a lie.
    expect(atCompileDone.built).toBe(true)
    expect(atCompileDone.contract.status).toBe('starting')
    expect(second.status).toBe('ready')
    expect(second.runId).toBe(first.runId)
    expect(second.compiledAt).not.toBe(first.compiledAt)
  }, 120_000)

  it('leaves the receipt at starting when a launch follows', async () => {
    const root = project()

    await build(root, {metadataCommand: 'start', launchFollows: true})

    const ready = readJson(readyContractPath(root, BROWSER))

    expect(ready.status).toBe('starting')
    expect(typeof ready.compiledAt).toBe('string')
  }, 120_000)

  it('records an error when the output cannot be put in place', async () => {
    const root = project()

    promote.fails = true

    await expect(build(root)).rejects.toMatchObject({
      code: 'E_DESTINATION_NOT_WRITABLE'
    })

    const ready = readJson(readyContractPath(root, BROWSER))

    expect(ready.status).toBe('error')
    expect(ready.code).toBe('build_failed')
    expect(ready.message).toContain('rename refused by the spec')
    expect(fs.existsSync(path.join(root, 'dist', BROWSER))).toBe(false)
  }, 120_000)

  it('records the failed archive and says the output is in place', async () => {
    const root = project()

    zip.fails = true

    await expect(build(root)).rejects.toMatchObject({code: 'E_ZIP_SKIPPED'})

    const ready = readJson(readyContractPath(root, BROWSER))
    const dist = path.join(root, 'dist', BROWSER)

    expect(ready.status).toBe('error')
    expect(ready.code).toBe('build_failed')
    expect(ready.message).toBe(
      'The distribution zip was requested and not created at ' +
        '/out/probe-chrome.zip: ENOSPC: no space left on device ' +
        `The output folder ${dist} is in place and loads as built.`
    )

    expect(ready.errors).toHaveLength(1)
    expect(ready.errors[0]).toMatch(/^E_ZIP_SKIPPED: /)
    expect(ready.distPath).toBe(dist)
    expect(fs.existsSync(path.join(dist, 'manifest.json'))).toBe(true)
  }, 120_000)

  it('keeps the compile error the plugin recorded', async () => {
    const root = project()

    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Ready after promote',
        version: '1.0.0',
        background: {service_worker: 'missing.js'}
      })
    )

    await expect(build(root)).rejects.toMatchObject({code: 'E_COMPILE'})

    const ready = readJson(readyContractPath(root, BROWSER))

    expect(ready.status).toBe('error')
    expect(ready.code).toBe('compile_error')
  }, 120_000)
})
