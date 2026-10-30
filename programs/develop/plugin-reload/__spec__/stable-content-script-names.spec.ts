import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'
import {stableContentScriptHash} from '../steps/stable-content-script-names'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function scaffold() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-stable-names-'))
  )
  roots.push(root)
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'stable-names',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'stable-names',
      version: '1.0.0',
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          js: ['src/early.ts'],
          run_at: 'document_start'
        }
      ]
    }),
    'src/early.ts': "console.log('early')\n",
    'src/page-only.ts': "export const P = 'a'\n",
    'pages/engine.html':
      '<!doctype html><html><body><script src="./engine.ts"></script></body></html>\n',
    'pages/engine.ts': "import {P} from '../src/page-only'\nconsole.log(P)\n"
  }

  for (const [relative, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive: true})
    fs.writeFileSync(path.join(root, relative), contents)
  }

  return root
}

async function contentScriptAsset(root: string) {
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: true, path: path.join(root, 'dist', 'chrome')}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  // The dev server adds the hot runtime, which bakes the compilation hash in
  config.plugins.push(new rspack.HotModuleReplacementPlugin())

  config.stats = false

  const assets = await new Promise<string[]>((resolve, reject) => {
    rspack(config).run((error, stats) => {
      if (error) return reject(error)
      if (!stats) return reject(new Error('no stats'))

      resolve(Object.keys(stats.compilation.assets))
    })
  })

  return assets.filter((name) =>
    /^content_scripts\/content-0\.[a-f0-9]+\.js$/.test(name)
  )
}

describe('a dev content script file name', () => {
  it('stays the same when only page code changes', async () => {
    const root = scaffold()
    const before = await contentScriptAsset(root)
    fs.writeFileSync(
      path.join(root, 'src/page-only.ts'),
      "export const P = 'b'\n"
    )

    const after = await contentScriptAsset(root)

    expect(before).toHaveLength(1)
    expect(after).toEqual(before)
  }, 180_000)

  it('changes when the content script itself changes', async () => {
    const root = scaffold()
    const before = await contentScriptAsset(root)
    fs.writeFileSync(path.join(root, 'src/early.ts'), "console.log('later')\n")
    const after = await contentScriptAsset(root)

    expect(after).toHaveLength(1)
    expect(after).not.toEqual(before)
  }, 180_000)
})

describe('stableContentScriptHash', () => {
  it('ignores the compilation hash the hot runtime bakes in and the file own name', () => {
    const a =
      '__webpack_require__.h = () => ("aaba3f29be46bc42")\n//# sourceMappingURL=content-1.486f4ee5.js.map'
    const b =
      '__webpack_require__.h = () => ("2278437384a22bdb")\n//# sourceMappingURL=content-1.63398ac6.js.map'

    expect(
      stableContentScriptHash(a, 'content_scripts/content-1.486f4ee5.js')
    ).toBe(stableContentScriptHash(b, 'content_scripts/content-1.63398ac6.js'))
  })
})
