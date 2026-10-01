import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const WORKSPACE_MODULES = path.resolve(__dirname, '../../../../node_modules')
const roots: string[] = []

const COMPONENT =
  "import {createRoot} from 'react-dom/client'\n" +
  'function App() {\n  return <h1>hello</h1>\n}\n' +
  'const host = document.createElement("div")\n' +
  'document.documentElement.appendChild(host)\n' +
  'createRoot(host).render(<App />)\n'

function scaffold() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-refresh-surface-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'extjs-refresh-surface',
      version: '0.0.0',
      dependencies: {react: '*', 'react-dom': '*'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'refresh-surface',
      version: '0.0.0',
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {js: ['main.jsx'], world: 'MAIN', matches: ['<all_urls>']},
        {js: ['isolated.jsx'], matches: ['<all_urls>']}
      ]
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="./popup.jsx"></script></body></html>'
  )

  fs.writeFileSync(
    path.join(root, 'popup.jsx'),
    "import {createRoot} from 'react-dom/client'\n" +
      'function App() {\n  return <h1>hello</h1>\n}\n' +
      "createRoot(document.getElementById('root')).render(<App />)\n"
  )

  fs.writeFileSync(path.join(root, 'main.jsx'), COMPONENT)
  fs.writeFileSync(path.join(root, 'isolated.jsx'), COMPONENT)
  fs.symlinkSync(WORKSPACE_MODULES, path.join(root, 'node_modules'), 'dir')

  return root
}

async function compileDev(root: string) {
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
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

  const distPath = path.join(root, 'dist', 'chrome')
  const read = (rel: string) =>
    fs.readFileSync(path.join(distPath, rel), 'utf8')
  const contentDir = path.join(distPath, 'content_scripts')
  const contentFile = (index: number) =>
    fs
      .readdirSync(contentDir)
      .find((name) =>
        new RegExp(`^content-${index}(\\.[a-f0-9]+)?\\.js$`).test(name)
      )

  // A page loads its entry chunk plus the shared ones, so the page side is
  // the whole set; a content script is always one file.
  const pageSide = fs
    .readdirSync(distPath, {recursive: true} as any)
    .map(String)
    .filter((name) => name.endsWith('.js') && !name.includes('content_scripts'))
    .map((name) => read(name))
    .join('\n')

  return {
    stats,
    popup: pageSide,
    main: read(path.join('content_scripts', String(contentFile(0)))),
    isolated: read(path.join('content_scripts', String(contentFile(1))))
  }
}

describe('react refresh runtime per surface (real rspack compile)', () => {
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  it('reaches the page and stays out of both content script worlds', async () => {
    const {stats, popup, main, isolated} = await compileDev(scaffold())
    expect(stats.hasErrors()).toBe(false)

    expect(popup).toContain('reactRefreshInjected')
    expect(popup).toContain('injectIntoGlobalHook')

    for (const [label, source] of [
      ['main', main],
      ['isolated', isolated]
    ] as const) {
      expect(source, `${label} carries the refresh client`).not.toContain(
        'reactRefreshInjected'
      )

      expect(source, `${label} installs the devtools hook`).not.toContain(
        'injectIntoGlobalHook'
      )

      expect(source, `${label} registers components`).not.toContain(
        '$ReactRefreshRuntime$'
      )
    }
  }, 120_000)

  it('keeps the host DOM instrumentation out of the MAIN world', async () => {
    const {main, isolated} = await compileDev(scaffold())

    expect(main).toMatch(
      /__EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED\s*=\s*false/
    )

    expect(isolated).toMatch(
      /__EXTENSIONJS_HOST_INSTRUMENTATION_ENABLED\s*=\s*true/
    )
  }, 120_000)
})
