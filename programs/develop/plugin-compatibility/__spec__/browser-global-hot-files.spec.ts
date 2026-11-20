import * as path from 'node:path'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {expect, it} from 'vitest'
import {compileIssues, writeProject} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {WarnBrowserGlobalWithoutPolyfill} from '../feature-browser-global'

const makeTempFolder = trackTempFolders()

// A rebuild writes each changed module again under hot/, with the name a dev
// session gives it, so the file was already read in the bundle it came from.
function emitHotChunk(name: string) {
  return {
    apply(compiler: Compiler) {
      compiler.hooks.thisCompilation.tap('emit-hot-chunk', (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'emit-hot-chunk',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => {
            compilation.emitAsset(
              name,
              new sources.RawSource('console.log(browser.runtime.id)\n')
            )
          }
        )
      })
    }
  }
}

it('reads no hot update file a dev session writes', async () => {
  const root = writeProject(makeTempFolder('extjs-browser-global-hot-'), {
    'manifest.json': {
      manifest_version: 3,
      name: 'Hot',
      version: '1.0.0',
      devtools_page: 'devtools.html'
    },
    'content.js': 'console.log(1)\n'
  })
  const {warnings} = await compileIssues(
    root,
    'development',
    {content: './content.js'},
    [
      emitHotChunk('hot/343.d2f4138b33e37f53.js'),
      new WarnBrowserGlobalWithoutPolyfill({
        manifestPath: path.join(root, 'manifest.json'),
        browser: 'chrome',
        devSession: true
      })
    ]
  )

  expect(warnings.map((warning) => warning.name)).not.toContain(
    'BrowserGlobalWithoutPolyfillWarning'
  )
})
