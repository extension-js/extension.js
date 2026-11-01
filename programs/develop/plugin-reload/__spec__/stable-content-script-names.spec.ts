import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
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

async function devConfig(root: string) {
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

  return config
}

async function devCompiler(root: string): Promise<Compiler> {
  const compiler = rspack(await devConfig(root))
  if (!compiler) throw new Error('no compiler')

  return compiler as Compiler
}

function compileOnce(compiler: Compiler) {
  return new Promise<Record<string, string>>((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) return reject(error)
      if (!stats) return reject(new Error('no stats'))

      const out: Record<string, string> = {}

      for (const asset of stats.compilation.getAssets()) {
        if (/^content_scripts\/content-0\.[a-f0-9]+\.js$/.test(asset.name)) {
          out[asset.name] = String(asset.source.source())
        }
      }

      resolve(out)
    })
  })
}

async function contentScriptAsset(root: string) {
  return Object.keys(await compileOnce(await devCompiler(root)))
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

  // The name no longer covers the hot runtime's compilation hash, so the same
  // name can carry new bytes. Emulated Chromium hashes what the compile
  // produced and refused the stale file the dist still held under that name.
  it('writes the new bytes to the dist when a page edit keeps the name', async () => {
    const root = scaffold()
    const compiler = await devCompiler(root)
    const before = await compileOnce(compiler)
    fs.writeFileSync(
      path.join(root, 'src/page-only.ts'),
      "export const P = 'b'\n"
    )

    const after = await compileOnce(compiler)
    const [name] = Object.keys(after)

    expect(Object.keys(before)).toEqual([name])
    expect(after[name]).not.toBe(before[name])
    expect(
      fs.readFileSync(path.join(root, 'dist', 'chrome', name), 'utf8')
    ).toBe(after[name])
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
