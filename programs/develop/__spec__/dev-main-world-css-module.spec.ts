import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import {SHEET_BLOCK_OPEN} from '../plugin-web-extension/feature-scripts/scripts-lib/runtime-script-sheet'
import webpackConfig from '../rspack-config'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

const script = (lane: string, sheet?: string) =>
  (sheet ? `import styles from './${sheet}'\n` : 'var styles = {}\n') +
  "var el = document.createElement('span')\n" +
  `el.className = styles.probe || '${lane}'\n` +
  'document.documentElement.appendChild(el)\n'

function project(options: {mainImportsSheet: boolean}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-main-css-module-')
  )
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'main-css-module', version: '0.0.0'})
  )

  write(root, 'background.js', 'console.log("bg")\n')
  write(root, 'isolated.module.css', '.probe { color: rgb(1, 30, 40); }\n')
  write(root, 'main.module.css', '.probe { color: rgb(4, 30, 40); }\n')
  write(root, 'isolated.js', script('isolated', 'isolated.module.css'))
  write(
    root,
    'main.js',
    script('main', options.mainImportsSheet ? 'main.module.css' : undefined)
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'main-css-module',
      version: '1.0.0',
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      },
      content_scripts: [
        {matches: ['https://a.example/*'], js: ['isolated.js']},
        {matches: ['https://a.example/*'], js: ['main.js'], world: 'MAIN'}
      ]
    })
  )

  return root
}

// The dev server runs the bundler with HMR on, and that is what sends a MAIN
// world group to a compilation of its own, so the spec compiles the same way.
async function compileDev(root: string, browser: 'chrome' | 'firefox') {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', browser)
  const config = webpackConfig(projectStructure, {
    browser,
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

  config.plugins.push(new rspack.HotModuleReplacementPlugin())
  config.stats = false

  const compiler: Compiler = rspack(config)
  // The dev server writes a file to disk as the bundler reports it here,
  // and a compilation run apart reports through the same hook.
  const written: string[] = []
  compiler.hooks.assetEmitted.tap('spec', (file) => {
    written.push(file)
  })

  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() => {
        if (error || !result) return reject(error || new Error('no stats'))

        resolve(result)
      })
    })
  })

  const read = (file: string) =>
    fs.readFileSync(path.join(distPath, file), 'utf8')

  return {stats, distPath, read, written}
}

interface Group {
  js?: string[]
  css?: string[]
  world?: string
}

describe('a MAIN world content script that imports a CSS module in dev', () => {
  it('has its sheet in the Chromium dev registry like the isolated one', async () => {
    const built = await compileDev(project({mainImportsSheet: true}), 'chrome')
    expect(built.stats.hasErrors()).toBe(false)

    const registry = JSON.parse(
      built.read('content_scripts/dev-registry.json')
    ) as {entries: Array<{entry: string; world: string; css: string[]}>}
    const entryOf = (name: string) =>
      registry.entries.find((entry) => entry.entry === name)

    expect(entryOf('content_scripts/content-0')?.css).toEqual([
      'content_scripts/content-0.css'
    ])

    const main = entryOf('content_scripts/content-1')
    expect(main?.world).toBe('MAIN')
    expect(main?.css).toEqual(['content_scripts/content-1.css'])
    expect(built.read('content_scripts/content-1.css')).toContain(
      'color: rgb(4, 30, 40)'
    )

    // The bridge that runs beside it has no sheet of its own.
    expect(entryOf('content_scripts/content-2')?.css).toEqual([])
  }, 120_000)

  it('has its sheet in the Firefox dev manifest like the isolated one', async () => {
    const built = await compileDev(project({mainImportsSheet: true}), 'firefox')
    expect(built.stats.hasErrors()).toBe(false)

    const groups = JSON.parse(built.read('manifest.json'))
      .content_scripts as Group[]
    const groupOf = (index: number) =>
      groups.find((group) =>
        (group.js || []).some((file) =>
          file.startsWith(`content_scripts/content-${index}.`)
        )
      )

    expect(groupOf(0)?.css).toEqual(['content_scripts/content-0.css'])
    expect(groupOf(1)?.world).toBe('MAIN')
    expect(groupOf(1)?.css).toEqual(['content_scripts/content-1.css'])
  }, 120_000)

  // Dev never cleans its output, so the sheet of an import the author has
  // removed is still on disk beside the bundle.
  it('names no sheet an earlier compile left behind', async () => {
    const root = project({mainImportsSheet: false})
    write(
      root,
      'dist/chrome/content_scripts/content-1.css',
      '.probe { color: rgb(9, 9, 9); }\n'
    )

    const built = await compileDev(root, 'chrome')
    expect(built.stats.hasErrors()).toBe(false)

    const registry = JSON.parse(
      built.read('content_scripts/dev-registry.json')
    ) as {entries: Array<{entry: string; css: string[]}>}

    expect(
      registry.entries.find(
        (entry) => entry.entry === 'content_scripts/content-1'
      )?.css
    ).toEqual([])
  }, 120_000)
})

// A scripts/ file the background registers in the MAIN world, beside one it
// registers in the isolated world, each with a CSS module of its own.
function runtimeProject() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-main-runtime-sheet-')
  )
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'main-runtime', version: '0.0.0'})
  )

  write(root, 'styles/page.module.css', '.probe { color: rgb(4, 30, 40); }\n')
  write(root, 'styles/near.module.css', '.probe { color: rgb(1, 30, 40); }\n')
  write(
    root,
    'scripts/page.js',
    "import styles from '../styles/page.module.css'\n" +
      'document.documentElement.className = styles.probe\n'
  )

  write(
    root,
    'scripts/near.js',
    "import styles from '../styles/near.module.css'\n" +
      'document.documentElement.className = styles.probe\n'
  )

  write(
    root,
    'background.js',
    'chrome.scripting.registerContentScripts([\n' +
      '  {id: "page", matches: ["https://a.example/*"], ' +
      'js: ["/scripts/page.js"], world: "MAIN"},\n' +
      '  {id: "near", matches: ["https://a.example/*"], ' +
      'js: ["/scripts/near.js"]}\n])\n'
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'main-runtime',
      version: '1.0.0',
      permissions: ['scripting'],
      host_permissions: ['https://a.example/*'],
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      }
    })
  )

  return root
}

function listed(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

describe.each([
  'chrome',
  'firefox'
] as const)('a MAIN world scripts/ file that imports a CSS module in dev, %s', (browser) => {
  it('carries its sheet and has no sheet file or map written to disk', async () => {
    const built = await compileDev(runtimeProject(), browser)
    expect(built.stats.hasErrors()).toBe(false)

    const emitted = listed(path.join(built.distPath, 'scripts'))
    const sheets = emitted.filter((name) => name.includes('.css'))
    const page = emitted.find((name) =>
      /^page\.(?:[0-9a-f]{8}\.)?js$/.test(name)
    )

    expect(sheets).toEqual([])
    expect(
      built.written.filter((name) => /\.css(?:\.map)?$/.test(name))
    ).toEqual([])

    expect(built.written).toContain(`scripts/${page}`)
    expect(page).toBeDefined()
    expect(built.read(path.join('scripts', String(page)))).toContain(
      SHEET_BLOCK_OPEN
    )
  }, 120_000)

  it('names its classes apart from every other bundle of the build', async () => {
    const built = await compileDev(runtimeProject(), browser)
    const emitted = listed(path.join(built.distPath, 'scripts'))

    // A registered file ships a copy a stored registration stays on.
    const classOf = (stem: string, copy = false) => {
      const file = emitted.find(
        (name) =>
          name.startsWith(`${stem}.`) &&
          name.endsWith('.js') &&
          name.includes('.extjs-main-world.') === copy
      )
      const text = built.read(path.join('scripts', String(file)))

      return /"probe":\s*"([^"]+)"/.exec(text)?.[1] || ''
    }

    // The bundle compiled apart numbers its own modules, so its name says so.
    expect(classOf('page')).toMatch(/^main-runtime-scripts-page-\w+-probe$/)
    expect(classOf('page', true)).toMatch(
      /^main-runtime-scripts-page-extjs-main-world-\w+-probe$/
    )

    expect(classOf('near')).toMatch(/^main-runtime-\w+-probe$/)
    expect(classOf('near')).not.toContain('scripts-near')
  }, 120_000)
})
