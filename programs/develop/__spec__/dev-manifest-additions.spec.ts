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

const NAMES_THE_PAGE =
  'window.addEventListener("open-demo", () => chrome.runtime.sendMessage({open: "pages/demo.html"}))\n'
const FRAMES_THE_PAGE =
  'const frame = document.createElement("iframe")\nframe.src = chrome.runtime.getURL("pages/demo.html")\ndocument.body.appendChild(frame)\n'

function project(options: {
  manifestVersion: 2 | 3
  contentScript?: string
  declared?: boolean
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-additions-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'dev-additions', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'pages', 'demo.html'),
    '<!doctype html>\r\n<html><body><h1>demo</h1><script src="./demo.js"></script></body></html>\r\n'
  )

  fs.writeFileSync(path.join(root, 'pages', 'demo.js'), 'console.log("demo")\n')
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')

  const v3 = options.manifestVersion === 3
  const manifest: Record<string, unknown> = {
    manifest_version: options.manifestVersion,
    name: 'dev-additions',
    version: '1.0.0',
    permissions: ['storage', 'contextMenus', 'debugger'],
    background: v3
      ? {service_worker: 'background.js'}
      : {scripts: ['background.js']}
  }

  if (options.contentScript) {
    fs.writeFileSync(path.join(root, 'content.js'), options.contentScript)
    manifest.content_scripts = [{matches: ['<all_urls>'], js: ['content.js']}]
  }

  if (options.declared) {
    manifest.web_accessible_resources = v3
      ? [{resources: ['pages/demo.html'], matches: ['https://a.example/*']}]
      : ['pages/demo.html']
  }

  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))

  return root
}

async function compile(
  root: string,
  browser: 'chrome' | 'firefox',
  mode: 'development' | 'production'
) {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', browser)
  const config = webpackConfig(projectStructure, {
    browser,
    mode,
    metadataCommand: mode === 'development' ? 'dev' : 'build',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) => plugin?.constructor.name !== 'plugin-browsers'
  )

  if (mode === 'development') {
    config.plugins.push(new rspack.HotModuleReplacementPlugin())
  }

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

  const readyPath = path.join(
    root,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )

  return {
    stats,
    manifest: JSON.parse(
      fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf8')
    ) as Record<string, any>,
    ready: (fs.existsSync(readyPath)
      ? JSON.parse(fs.readFileSync(readyPath, 'utf8'))
      : {}) as Record<string, any>
  }
}

function exposedResources(manifest: Record<string, any>): string[] {
  const declared = manifest.web_accessible_resources || []

  return declared.flatMap((entry: any) =>
    typeof entry === 'string' ? [entry] : entry.resources || []
  )
}

describe('what a dev session adds to the manifest', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    it(`keeps a pages/ page a content script only names off web_accessible_resources on ${browser}`, async () => {
      const root = project({manifestVersion: 3, contentScript: NAMES_THE_PAGE})
      const dev = await compile(root, browser, 'development')
      expect(dev.stats.hasErrors()).toBe(false)

      expect(dev.manifest.web_accessible_resources).toEqual([
        {
          resources: ['hot/*', 'extension-js-control.json'],
          matches: ['<all_urls>']
        }
      ])
    })
  }

  it('keeps that page off the production list too', async () => {
    const root = project({manifestVersion: 3, contentScript: NAMES_THE_PAGE})
    const built = await compile(root, 'chrome', 'production')
    expect(built.stats.hasErrors()).toBe(false)

    expect(built.manifest.web_accessible_resources).toBeUndefined()
    expect(built.ready.devAdditions).toBeUndefined()
  })

  it('still exposes a page the content script asks runtime.getURL for', async () => {
    const root = project({manifestVersion: 3, contentScript: FRAMES_THE_PAGE})
    const dev = await compile(root, 'chrome', 'development')
    expect(dev.stats.hasErrors()).toBe(false)

    expect(exposedResources(dev.manifest)).toContain('pages/demo.html')

    // The production build exposes it as well, so it is no dev addition.
    expect(
      dev.ready.devAdditions.map((entry: {value: string}) => entry.value)
    ).not.toContain('pages/demo.html')
  })

  it('keeps the scope the source manifest gave a page it lists', async () => {
    const root = project({
      manifestVersion: 3,
      contentScript: NAMES_THE_PAGE,
      declared: true
    })
    const dev = await compile(root, 'chrome', 'development')
    expect(dev.stats.hasErrors()).toBe(false)

    expect(dev.manifest.web_accessible_resources).toEqual([
      {resources: ['pages/demo.html'], matches: ['https://a.example/*']},
      {
        resources: ['hot/*', 'extension-js-control.json'],
        matches: ['<all_urls>']
      }
    ])
  })

  it('adds no web accessible resource and no host when no content script runs', async () => {
    const root = project({manifestVersion: 3})
    const dev = await compile(root, 'chrome', 'development')
    expect(dev.stats.hasErrors()).toBe(false)

    expect(dev.manifest.web_accessible_resources).toBeUndefined()
    expect(dev.manifest.host_permissions).toBeUndefined()
    expect(dev.ready.devAdditions).toEqual([
      expect.objectContaining({kind: 'permission', value: 'scripting'}),
      expect.objectContaining({kind: 'permission', value: 'tabs'})
    ])
  })

  it('carries every dev-only grant in the ready contract with its reason', async () => {
    const root = project({manifestVersion: 3, contentScript: NAMES_THE_PAGE})
    const dev = await compile(root, 'chrome', 'development')
    const built = await compile(root, 'chrome', 'production')
    const additions = dev.ready.devAdditions as Array<Record<string, any>>

    expect(additions.map((entry) => `${entry.kind} ${entry.value}`)).toEqual([
      'permission scripting',
      'permission tabs',
      'host_permission <all_urls>',
      'web_accessible_resource hot/*',
      'web_accessible_resource extension-js-control.json'
    ])

    for (const entry of additions) {
      expect(entry.reason.length).toBeGreaterThan(20)
    }

    expect(additions[3].matches).toEqual(['<all_urls>'])

    // The list is the whole difference: taking it away leaves the grants
    // the production build ships.
    const added = (kind: string) =>
      additions.filter((entry) => entry.kind === kind).map((e) => e.value)

    expect(
      dev.manifest.permissions.filter(
        (permission: string) => !added('permission').includes(permission)
      )
    ).toEqual(built.manifest.permissions)

    expect(
      dev.manifest.host_permissions.filter(
        (host: string) => !added('host_permission').includes(host)
      )
    ).toEqual(built.manifest.host_permissions || [])

    expect(
      exposedResources(dev.manifest).filter(
        (resource) => !added('web_accessible_resource').includes(resource)
      )
    ).toEqual(exposedResources(built.manifest))
  })

  it('reports the Manifest V2 shape on Firefox, hosts under permissions', async () => {
    const root = project({manifestVersion: 2, contentScript: NAMES_THE_PAGE})
    const dev = await compile(root, 'firefox', 'development')
    expect(dev.stats.hasErrors()).toBe(false)

    expect(dev.manifest.web_accessible_resources).toEqual([
      'hot/*',
      'extension-js-control.json'
    ])

    expect(
      (dev.ready.devAdditions as Array<Record<string, any>>).map(
        (entry) => `${entry.kind} ${entry.value}`
      )
    ).toEqual([
      'permission tabs',
      'host_permission <all_urls>',
      'web_accessible_resource hot/*',
      'web_accessible_resource extension-js-control.json'
    ])
  })
})
