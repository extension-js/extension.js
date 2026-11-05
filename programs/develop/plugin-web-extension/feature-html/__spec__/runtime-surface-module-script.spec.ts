import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

const roots: string[] = []

function scaffold(name: string, files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-runtime-page-${name}-`))
  )
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: `extjs-runtime-page-${name}`,
      version: '0.0.0'
    })
  )

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, contents)
  }

  return root
}

async function compile(root: string, mode: 'development' | 'production') {
  const distPath = path.join(root, 'dist', 'chrome')
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'production' ? 'build' : 'dev',
    silent: true,
    output: {clean: true, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  const stats = await new Promise<Stats>((resolve, reject) => {
    rspack(config).run((error, result) => {
      if (error) return reject(error)
      if (!result) return reject(new Error('no stats'))

      resolve(result)
    })
  })

  const read = (relative: string) =>
    fs.readFileSync(path.join(distPath, relative), 'utf-8')

  return {
    errors: (stats.toJson({errors: true}).errors || []).map(
      (error) => error.message || String(error)
    ),
    has: (relative: string) => fs.existsSync(path.join(distPath, relative)),
    read
  }
}

// Chrome's cookbook.sidepanel-open sample: the worker opens page.html with
// tabs.create, the page loads its script with type="module", and the script
// uses top-level await with no import or export. Chrome runs it as a module
// because the tag says so; the build has to read the same tag.
const fixture = {
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'runtime-surface-module',
    version: '0.0.0',
    background: {service_worker: 'service-worker.js'}
  }),
  'service-worker.js':
    'chrome.runtime.onInstalled.addListener(() => {\n' +
    "  chrome.tabs.create({url: 'page.html'})\n" +
    '})\n',
  'page.html':
    '<!doctype html><html><body>' +
    '<button id="open">Open</button>' +
    '<script src="script.js" type="module"></script>' +
    '</body></html>\n',
  'script.js':
    'const [tab] = await chrome.tabs.query({active: true})\n' +
    "document.title = 'runtimeSurfaceModuleTla' + tab.id\n"
}

describe('a module script on a page only a script opens at runtime', () => {
  afterAll(() => {
    for (const root of roots) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it.each([
    'production',
    'development'
  ] as const)('compiles top-level await on a tabs.create page as a module (%s)', async (mode) => {
    const root = scaffold(mode, fixture)

    const build = await compile(root, mode)

    expect(build.errors).toEqual([])
    expect(build.has('page.html')).toBe(true)
    expect(build.read('page.html')).toContain('type="module"')
    expect(build.read('page.js')).toContain('runtimeSurfaceModuleTla')
  }, 120_000)
})
