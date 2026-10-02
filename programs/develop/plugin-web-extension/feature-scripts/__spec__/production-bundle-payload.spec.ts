import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

const roots: string[] = []

// Dev scaffolding the wrapper installs so a bundle can replace itself in a
// live page. None of it has a job in a bundle the browser injects once.
const DEV_REINJECT_MARKERS = [
  '__EXTENSIONJS_DEV_REINJECT__',
  'data-extjs-reinject-owner',
  'data-extjs-reinject-build'
]

function scaffold(name: string, files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-payload-${name}-`))
  )
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: `extjs-payload-${name}`,
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

  const emitted = fs.existsSync(distPath)
    ? (fs.readdirSync(distPath, {recursive: true} as any) as unknown[])
        .map((entry) => String(entry).split(path.sep).join('/'))
        .filter((entry) => fs.statSync(path.join(distPath, entry)).isFile())
        .sort()
    : []

  return {
    distPath,
    emitted,
    errors: (stats.toJson({errors: true}).errors || []).map(
      (error) => error.message || String(error)
    ),
    read: (relative: string) =>
      fs.readFileSync(path.join(distPath, relative), 'utf-8')
  }
}

function countMarkers(text: string) {
  return DEV_REINJECT_MARKERS.map((marker) => ({
    marker,
    hits: text.split(marker).length - 1
  }))
}

afterAll(() => {
  for (const root of roots) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('what a production bundle ships', () => {
  it('keeps the reinject scaffolding out of a production content script', async () => {
    const root = scaffold('content-script', {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'payload',
        version: '1.0.0',
        content_scripts: [
          {matches: ['https://example.com/*'], js: ['content/index.ts']}
        ]
      }),
      'content/index.ts': 'console.log("CS_ONLY")\nexport {}\n'
    })

    const production = await compile(root, 'production')
    expect(production.errors).toEqual([])

    const productionBundle = production.read('content_scripts/content-0.js')

    expect(countMarkers(productionBundle)).toEqual(
      DEV_REINJECT_MARKERS.map((marker) => ({marker, hits: 0}))
    )

    // A ceiling, not a measurement: the scaffolding was 7.2 KB of it, and
    // nothing but a regression puts that kind of weight back.
    expect(Buffer.byteLength(productionBundle, 'utf-8')).toBeLessThan(1024)

    const development = await compile(root, 'development')
    expect(development.errors).toEqual([])

    // The same fixture in development still carries the mechanism, which is
    // what makes the production assertion a mode gate and not a deletion.
    // Development cache-busts the bundle name, so match it by its entry.
    const developmentName = development.emitted.find((entry) =>
      /^content_scripts\/content-0.*\.js$/.test(entry)
    )

    expect(developmentName, development.emitted.join(', ')).toBeTruthy()

    const developmentBundle = development.read(String(developmentName))

    expect(
      developmentBundle.split('__EXTENSIONJS_DEV_REINJECT__').length - 1
    ).toBeGreaterThan(0)

    expect(developmentBundle).toContain('data-extjs-reinject-owner')
    expect(developmentBundle).toContain('data-extjs-reinject-build')
  }, 180_000)

  it('still hydrates a production content script that ships a stylesheet', async () => {
    const styles = Array.from(
      {length: 400},
      (_, index) => `.payloadRule${index} { outline-width: ${index}px }`
    ).join('\n')

    const root = scaffold('content-script-css', {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'payload-css',
        version: '1.0.0',
        content_scripts: [
          {matches: ['https://example.com/*'], js: ['content/index.ts']}
        ]
      }),
      // The stylesheet rides in through a sibling module, so the sheet is
      // emitted next to the bundle instead of inlined into it.
      'content/styles.css': styles,
      'content/panel.ts':
        'import "./styles.css"\nexport const label = "panel"\n',
      'content/index.ts':
        'import {label} from "./panel"\n' +
        'export default function(){\n' +
        '  const host = document.createElement("div")\n' +
        '  host.id = "extension-root"\n' +
        '  document.body.appendChild(host)\n' +
        '  host.attachShadow({mode: "open"}).innerHTML = label\n' +
        '  return () => host.remove()\n' +
        '}\n'
    })

    const production = await compile(root, 'production')
    expect(production.errors).toEqual([])

    const bundle = production.read('content_scripts/content-0.js')

    expect(countMarkers(bundle)).toEqual(
      DEV_REINJECT_MARKERS.map((marker) => ({marker, hits: 0}))
    )

    expect(production.emitted).toContain('content_scripts/content-0.css')
    // The hydration lifts the emitted sheet into the shadow root, so it is the
    // one piece of the wrapper a production content script still needs.
    expect(bundle).toContain('data-extjs-bundle-css')
    expect(bundle).toContain('content_scripts/content-0.css')
  }, 180_000)

  it('emits a service worker living in scripts/ exactly once', async () => {
    const root = scaffold('sw-in-scripts', {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'payload-sw',
        version: '1.0.0',
        background: {service_worker: 'scripts/background.ts'},
        web_accessible_resources: [
          {
            resources: ['scripts/injected.js'],
            matches: ['https://example.com/*']
          }
        ]
      }),
      'scripts/background.ts': 'console.log("SW_MARKER")\nexport {}\n',
      'scripts/injected.ts': 'console.log("INJECTED_MARKER")\nexport {}\n'
    })

    const production = await compile(root, 'production')
    expect(production.errors).toEqual([])

    const manifest = JSON.parse(production.read('manifest.json')) as {
      background?: {service_worker?: string}
    }

    expect(manifest.background?.service_worker).toBe(
      'background/service_worker.js'
    )

    const workerCopies = production.emitted.filter((entry) =>
      production.read(entry).includes('SW_MARKER')
    )

    expect(workerCopies).toEqual(['background/service_worker.js'])
    expect(production.emitted).not.toContain('scripts/background.js')

    // A scripts/ file nothing but web_accessible_resources reaches has no
    // field of its own, so the scripts/ lane stays its only way out.
    expect(production.emitted).toContain('scripts/injected.js')
    expect(production.read('scripts/injected.js')).toContain('INJECTED_MARKER')

    expect(
      countMarkers(production.read('background/service_worker.js'))
    ).toEqual(DEV_REINJECT_MARKERS.map((marker) => ({marker, hits: 0})))
  }, 180_000)
})
