import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Compilation, type Compiler, rspack, sources} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {MAIN_WORLD_BRIDGE_PAIRING_MARK} from '../scripts-lib/main-world-bridge-pairing'
import {MAIN_WORLD_COPY_ROUTING_MARK} from '../scripts-lib/main-world-copy-routing'
import {withMainWorldCopyEntries} from '../scripts-lib/runtime-main-world-scripts'
import {PairRuntimeMainWorldBridges} from '../steps/pair-runtime-main-world-bridges'
import {RouteMainWorldCopies} from '../steps/route-main-world-copies'

// The pairing and the routing are prepended to the background bundle. A
// file of the project in a deeper folder named background is no background.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const BACKGROUND =
  'chrome.scripting.registerContentScripts([\n' +
  "  {id: 'iso', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'ISOLATED'},\n" +
  "  {id: 'main', js: ['scripts/hook.js'], matches: ['<all_urls>'], world: 'MAIN'}\n" +
  '])\n'

async function compiled(first: Array<{apply(compiler: Compiler): void}> = []) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-background-folder-'))
  )
  roots.push(root)

  const at = (...parts: string[]) => path.join(root, ...parts)
  const files: Record<string, string> = {
    'manifest.json': '{}',
    'background.js': BACKGROUND,
    'scripts/hook.js': 'window.__HOOK__ = 1\n',
    'vendor/background/index.js': 'globalThis.__VENDOR__ = 1\n',
    'vendor/background/scripts.js': 'globalThis.__VENDOR__ = 2\n'
  }

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(at(...name.split('/'))), {recursive: true})
    fs.writeFileSync(at(...name.split('/')), text)
  }

  const includeList = withMainWorldCopyEntries({
    includeList: {
      'background/scripts': at('background.js'),
      'scripts/hook': at('scripts', 'hook.js')
    },
    manifestDir: root,
    projectPath: root
  })
  const options = {
    manifestPath: at('manifest.json'),
    browser: 'firefox' as const,
    includeList
  }

  const errors = await new Promise<string[]>((resolve, reject) => {
    const compiler = rspack({
      context: root,
      mode: 'development',
      devtool: false,
      entry: {
        'background/scripts': at('background.js'),
        'scripts/hook': at('scripts', 'hook.js'),
        'vendor/background/index': at('vendor', 'background', 'index.js'),
        'vendor/background/scripts': at('vendor', 'background', 'scripts.js')
      },
      output: {path: at('dist'), filename: '[name].js'},
      plugins: [
        ...first,
        new PairRuntimeMainWorldBridges(options),
        new RouteMainWorldCopies(options)
      ]
    })

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) reject(error)
        else resolve((stats?.compilation.errors || []).map((e) => e.message))
      })
    })
  })

  expect(errors).toEqual([])

  return (...parts: string[]) => fs.readFileSync(at('dist', ...parts), 'utf8')
}

describe('a file in a deeper folder named background', () => {
  it('gets neither the bridge pairing nor the copy routing', async () => {
    const emitted = await compiled()
    const background = emitted('background', 'scripts.js')

    expect(background).toContain(MAIN_WORLD_BRIDGE_PAIRING_MARK)
    expect(background).toContain(MAIN_WORLD_COPY_ROUTING_MARK)

    for (const name of ['index.js', 'scripts.js']) {
      const vendor = emitted('vendor', 'background', name)

      expect(vendor).toContain('__VENDOR__')
      expect(vendor).not.toContain(MAIN_WORLD_BRIDGE_PAIRING_MARK)
      expect(vendor).not.toContain(MAIN_WORLD_COPY_ROUTING_MARK)
    }
  }, 120000)
})

// Another owner prepending to the background at REPORT+100, the dev session's
// replay shim among them, registered here ahead of the pairing.
const OTHER = '/* another owner */'
const prependsAtTheSameStage = {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('other-owner', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'other-owner',
          stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
        },
        () => {
          const asset = compilation.getAsset('background/scripts.js')
          if (!asset) return

          compilation.updateAsset(
            asset.name,
            new sources.ConcatSource(`${OTHER}\n`, asset.source)
          )
        }
      )
    })
  }
}

describe('the pairing prepend', () => {
  it('stays inside another background prepend whichever plugin registered first', async () => {
    const background = (await compiled([prependsAtTheSameStage]))(
      'background',
      'scripts.js'
    )

    expect(background.indexOf(OTHER)).toBeGreaterThanOrEqual(0)
    expect(background.indexOf(OTHER)).toBeLessThan(
      background.indexOf(MAIN_WORLD_BRIDGE_PAIRING_MARK)
    )
  }, 120000)
})
