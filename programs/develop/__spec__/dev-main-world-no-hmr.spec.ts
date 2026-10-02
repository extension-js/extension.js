import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(options: {hashContentScripts?: boolean} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-world-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'main-world', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'page-world.js'),
    'window.__MAIN_WORLD_MARK__ = "page"\nconsole.log("main world")\n'
  )

  fs.writeFileSync(
    path.join(root, 'isolated.js'),
    'console.log("isolated " + document.title)\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'main-world',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['https://a.example/*'], js: ['isolated.js']},
        {
          matches: ['https://a.example/*'],
          js: ['page-world.js'],
          world: 'MAIN',
          run_at: 'document_start'
        }
      ]
    })
  )

  return {root, ...options}
}

function runtimeRegisteredProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-world-rt-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'main-world-rt', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'scripts'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'scripts', 'hook.js'),
    'window.__PAGE_HOOK__ = "installed"\n'
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'chrome.runtime.onInstalled.addListener(function () {',
      '  chrome.scripting.registerContentScripts([',
      '    {',
      '      id: "page-hook",',
      '      js: ["scripts/hook.js"],',
      '      world: "MAIN",',
      '      matches: ["<all_urls>"],',
      '      runAt: "document_start"',
      '    }',
      '  ])',
      '})',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'main-world-rt',
      version: '1.0.0',
      permissions: ['scripting'],
      background: {service_worker: 'background.js'}
    })
  )

  return {root}
}

// The dev server runs the bundler with HMR on, which is what puts the hot
// update runtime into every entry chunk, so the spec compiles the same way.
async function compileDev(
  root: string,
  options: {hashContentScripts?: boolean} = {}
) {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath},
    ...options
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.plugins.push(new rspack.HotModuleReplacementPlugin())
  config.stats = false

  const compiler: Compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() => {
        if (error || !result) return reject(error || new Error('no stats'))

        resolve(result)
      })
    })
  })

  const manifest = JSON.parse(
    fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf8')
  )
  const registryPath = path.join(
    distPath,
    'content_scripts',
    'dev-registry.json'
  )
  const registry = (
    fs.existsSync(registryPath)
      ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      : {entries: []}
  ) as {entries: Array<{entry: string; js: string[]; world: string}>}

  const bundleOf = (entryName: string) => {
    const entry = registry.entries.find((item) => item.entry === entryName)
    if (!entry) throw new Error(`no registry entry for ${entryName}`)

    return {
      name: entry.js[0],
      text: fs.readFileSync(path.join(distPath, entry.js[0]), 'utf8'),
      world: entry.world
    }
  }

  return {stats, distPath, manifest, registry, bundleOf}
}

describe('a MAIN world content script in dev', () => {
  it('ships without the HMR runtime while the isolated sibling keeps it', async () => {
    const {root} = project()
    const built = await compileDev(root)
    expect(built.stats.hasErrors()).toBe(false)

    const main = built.bundleOf('content_scripts/content-1')
    expect(main.world).toBe('MAIN')
    expect(main.name).toMatch(/^content_scripts\/content-1\.[a-f0-9]{8}\.js$/)
    expect(main.text).toContain('__MAIN_WORLD_MARK__')
    expect(main.text).not.toContain('rspackHotUpdate')
    expect(main.text).not.toContain('hmrC')
    expect(main.text).not.toContain('hot-update')

    expect(main.text).not.toContain('Node.prototype.removeChild')
    expect(main.text).not.toContain('new MutationObserver')

    const isolated = built.bundleOf('content_scripts/content-0')
    expect(isolated.world).toBe('ISOLATED')
    expect(isolated.text).toContain('rspackHotUpdate')
    expect(isolated.text).toContain('Node.prototype.removeChild')

    // The content script loader rules still ran: the dev wrapper marks the
    // bundle for the registry like any other content script.
    expect(main.text).toContain('content_scripts/content-1')
    expect(built.stats.compilation.getAsset(`${main.name}.map`)).toBeTruthy()
  }, 120_000)

  it('keeps a plain name when content script hashing is off', async () => {
    const {root} = project()
    const built = await compileDev(root, {hashContentScripts: false})
    expect(built.stats.hasErrors()).toBe(false)

    const main = built.bundleOf('content_scripts/content-1')
    expect(main.name).toBe('content_scripts/content-1.js')
    expect(main.text).not.toContain('rspackHotUpdate')
  }, 120_000)
})

describe('a MAIN world script registered at runtime in dev', () => {
  it('ships without the HMR runtime or the host instrumentation', async () => {
    const {root} = runtimeRegisteredProject()
    const built = await compileDev(root)
    expect(built.stats.hasErrors()).toBe(false)

    const hook = fs.readFileSync(
      path.join(built.distPath, 'scripts', 'hook.js'),
      'utf8'
    )

    expect(hook).toContain('__PAGE_HOOK__')
    expect(hook).toMatch(
      /__EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED\s*=\s*false/
    )

    expect(hook).not.toContain('Node.prototype.removeChild')
    expect(hook).not.toContain('new MutationObserver')
    expect(hook).not.toContain('rspackHotUpdate')
    expect(hook).not.toContain('hmrC')
    expect(hook).not.toContain('hot-update')
  }, 120_000)
})
