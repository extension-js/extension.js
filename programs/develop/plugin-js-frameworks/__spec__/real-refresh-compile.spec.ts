import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const WORKSPACE_MODULES = path.resolve(__dirname, '../../../../node_modules')
const roots: string[] = []

function scaffold(name: string, framework: 'react' | 'preact') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `extjs-refresh-${name}-`))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        private: true,
        name: `extjs-refresh-${name}`,
        version: '0.0.0',
        dependencies: {[framework]: '*'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: `refresh-${name}`,
        version: '0.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="./popup.jsx"></script></body></html>'
  )
  fs.writeFileSync(
    path.join(root, 'popup.jsx'),
    framework === 'react'
      ? "import {createRoot} from 'react-dom/client'\n" +
          'function App() {\n  return <h1>hello</h1>\n}\n' +
          "createRoot(document.getElementById('root')).render(<App />)\n"
      : "import {render} from 'preact'\n" +
          'function App() {\n  return <h1>hello</h1>\n}\n' +
          "render(<App />, document.getElementById('root'))\n"
  )

  // The refresh plugin and the framework runtime resolve from the project, so
  // the fixture borrows this workspace's installed copies instead of its own.
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
  const emitted = fs
    .readdirSync(distPath, {recursive: true} as any)
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(distPath, entry), 'utf-8'))
    .join('\n')

  return {stats, emitted}
}

describe('js framework refresh plugins (real rspack compile)', () => {
  afterAll(() => {
    for (const root of roots) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('wires the React refresh runtime into a development build', async () => {
    const {stats, emitted} = await compileDev(scaffold('react', 'react'))

    expect(stats.hasErrors()).toBe(false)
    expect(emitted).toContain('$RefreshReg$')
    expect(emitted).toContain('$RefreshSig$')
  }, 120_000)

  // Preact fast-refresh stays off on purpose: rspack 2.x renames the module
  // argument out from under the plugin's vendored runtime, so dev live-reloads.
  it('builds Preact in development without the refresh runtime', async () => {
    const {stats, emitted} = await compileDev(scaffold('preact', 'preact'))

    expect(stats.hasErrors()).toBe(false)
    expect(emitted.toLowerCase()).not.toContain('prefresh')
    expect(emitted).toContain('preact')
  }, 120_000)
})
