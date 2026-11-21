import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {HtmlPlugin} from '../index'

const tempFolder = trackTempFolders()

function writeProject() {
  // The real path, so the rule's include matches what rspack resolves.
  const root = fs.realpathSync(tempFolder('extjs-page-info-'))
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

  fs.writeFileSync(
    path.join(src, 'background.js'),
    'console.log("BACKGROUND_ENTRY_MODULE")\n'
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

describe('the built page asset', () => {
  it('names the source page in the built page asset info', async () => {
    const root = writeProject()
    const manifestPath = path.join(root, 'src', 'manifest.json')
    const htmlPath = path.join(root, 'src', 'newtab', 'index.html')
    let info: {sourceFilename?: string} | undefined

    const compiler = rspack({
      mode: 'development',
      context: root,
      devtool: false,
      entry: {},
      output: {path: path.join(root, 'dist')},
      plugins: [
        new HtmlPlugin({
          manifestPath,
          browser: 'chrome',
          includeList: {'chrome_url_overrides/newtab': htmlPath}
        }),
        {
          apply(c: Compiler) {
            c.hooks.done.tap('read-page-info', (stats) => {
              info = stats.compilation.getAsset(
                'chrome_url_overrides/newtab.html'
              )?.info
            })
          }
        }
      ]
    })

    await compile(compiler)

    expect(info?.sourceFilename).toBe('src/newtab/index.html')
  }, 60000)
})
