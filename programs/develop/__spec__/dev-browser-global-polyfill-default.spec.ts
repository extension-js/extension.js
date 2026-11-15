import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {DEV_COMMAND_DEFAULTS, mergeOptionLayers} from '../lib/merge-options'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(manifestExtras: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-polyfill-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'dev-polyfill', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'dev-polyfill',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      ...manifestExtras
    })
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    'browser.storage.local.get("k").then((v) => console.log(v))\n'
  )

  if (manifestExtras.devtools_page) {
    fs.writeFileSync(
      path.join(root, String(manifestExtras.devtools_page)),
      '<!doctype html><title>devtools</title>'
    )
  }

  return root
}

// Compiles the way `extension dev` does: its stock defaults under whatever
// the command line or the config file set.
async function devCompile(root: string, typed: {polyfill?: boolean} = {}) {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', 'chrome')
  const options = mergeOptionLayers<Record<string, unknown>>(
    DEV_COMMAND_DEFAULTS,
    typed
  )
  const config = webpackConfig(projectStructure, {
    ...options,
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  const compiler: Compiler = rspack(config)

  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      if (error || !result) return reject(error || new Error('no stats'))

      resolve(result)
    })
  })
  await new Promise<void>((resolve) => compiler.close(() => resolve()))

  const warnings = (stats.toJson({all: false, warnings: true}).warnings || [])
    .map((warning) => String(warning.message))
    .filter((text) => text.includes('uses browser.*'))
  const worker = fs.readFileSync(
    path.join(distPath, 'background', 'service_worker.js'),
    'utf-8'
  )

  return {warnings, worker, errors: stats.compilation.errors.length}
}

describe('an extension dev session of browser.* code on a Chromium target', () => {
  it('leaves the polyfill out by default and says nothing', async () => {
    const {warnings, worker, errors} = await devCompile(project())

    expect(errors).toBe(0)
    expect(worker).toContain('browser.storage.local')
    expect(worker).not.toContain('webextension-polyfill')
    expect(warnings).toEqual([])
  }, 120_000)

  it('bundles the polyfill when the session asks for it', async () => {
    const {warnings, worker, errors} = await devCompile(project(), {
      polyfill: true
    })

    expect(errors).toBe(0)
    expect(worker).toContain('webextension-polyfill')
    expect(warnings).toEqual([])
  }, 120_000)

  it('names the devtools_page exception, which a current Chromium still has', async () => {
    const {warnings, worker, errors} = await devCompile(
      project({devtools_page: 'devtools.html'})
    )

    expect(errors).toBe(0)
    expect(worker).not.toContain('webextension-polyfill')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('background.js:1 uses browser.*')
    expect(warnings[0]).toContain(
      'only from Chromium 152 in an extension that declares a devtools_page'
    )

    expect(warnings[0]).toContain('run extension dev with --polyfill')
    expect(warnings[0]).toContain('set commands.dev.polyfill to true')
  }, 120_000)

  it('stays quiet for a devtools_page once the manifest starts at Chromium 152', async () => {
    const {warnings} = await devCompile(
      project({devtools_page: 'devtools.html', minimum_chrome_version: '152'})
    )

    expect(warnings).toEqual([])
  }, 120_000)

  it('stays quiet for a devtools_page with the polyfill on', async () => {
    const {warnings, worker} = await devCompile(
      project({devtools_page: 'devtools.html'}),
      {polyfill: true}
    )

    expect(worker).toContain('webextension-polyfill')
    expect(warnings).toEqual([])
  }, 120_000)
})
