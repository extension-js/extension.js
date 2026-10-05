import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {HtmlPlugin} from '../index'

const PRELUDE_MARK = 'Error clearing HTML containers'
const tmpRoots: string[] = []

afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, {recursive: true, force: true})
})

function writeProject() {
  // The real path, so the rule's include matches what rspack resolves.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-hmr-'))
  )
  tmpRoots.push(root)
  const src = path.join(root, 'src')
  fs.mkdirSync(path.join(src, 'newtab'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'page-hmr', private: true})
  )

  fs.writeFileSync(
    path.join(src, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'page-hmr',
      version: '0.0.1',
      chrome_url_overrides: {newtab: 'newtab/index.html'}
    })
  )

  fs.writeFileSync(
    path.join(src, 'newtab', 'index.html'),
    '<!doctype html><html><body><div id="root"></div>' +
      '<script type="module" src="./scripts.js"></script></body></html>'
  )

  fs.writeFileSync(
    path.join(src, 'newtab', 'scripts.js'),
    "import {label} from './App.js'\n" +
      "document.getElementById('root').textContent = label\n" +
      'console.log("PAGE_ENTRY_MODULE")\n'
  )

  fs.writeFileSync(
    path.join(src, 'newtab', 'App.js'),
    'export const label = "PAGE_CHILD_MODULE"\n'
  )

  return root
}

function compile(compiler: Compiler) {
  return new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => {})
      if (error) return reject(error)

      if (stats?.hasErrors()) {
        return reject(new Error(stats.toString({all: false, errors: true})))
      }

      resolve()
    })
  })
}

// Splits the dev bundle into its module factories, keyed by module id.
function moduleBodies(bundle: string) {
  const bodies = new Map<string, string>()
  const re = /^"([^"]+)"\s*(?::\s*\(?function\s*)?\(/gm
  const starts: Array<{id: string; at: number}> = []
  let match: RegExpExecArray | null

  while ((match = re.exec(bundle))) {
    starts.push({id: match[1], at: match.index})
  }

  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : bundle.length
    bodies.set(start.id, bundle.slice(start.at, end))
  })

  return bodies
}

describe('page HMR prelude in a real rspack compile', () => {
  it('lands only on the page entry, never on a module the entry imports', async () => {
    const root = writeProject()
    const manifestPath = path.join(root, 'src', 'manifest.json')
    const htmlPath = path.join(root, 'src', 'newtab', 'index.html')
    const outDir = path.join(root, 'dist')

    const compiler = rspack({
      mode: 'development',
      context: root,
      devtool: false,
      entry: {},
      output: {path: outDir},
      plugins: [
        new rspack.HotModuleReplacementPlugin(),
        new HtmlPlugin({
          manifestPath,
          browser: 'chrome',
          devSession: true,
          includeList: {'chrome_url_overrides/newtab': htmlPath}
        })
      ]
    })

    await compile(compiler)

    const bundle = fs.readFileSync(
      path.join(outDir, 'chrome_url_overrides', 'newtab.js'),
      'utf8'
    )
    const bodies = moduleBodies(bundle)
    const entry = [...bodies.entries()].find(([, body]) =>
      body.includes('PAGE_ENTRY_MODULE')
    )
    const child = [...bodies.entries()].find(([, body]) =>
      body.includes('PAGE_CHILD_MODULE')
    )

    expect(entry?.[0]).toMatch(/src\/newtab\/scripts\.js$/)
    expect(child?.[0]).toMatch(/src\/newtab\/App\.js$/)
    expect(entry?.[1]).toContain(PRELUDE_MARK)
    expect(child?.[1]).not.toContain(PRELUDE_MARK)
    expect(child?.[1]).not.toMatch(/\.accept\(\)/)
  }, 60000)
})
