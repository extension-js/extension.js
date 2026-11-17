import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {WasmPlugin} from '../../plugin-wasm'
import {StaticAssetsPlugin} from '../index'
import {bundledAssetOutputName} from '../static-assets-lib/asset-output-name'
import {
  assertOutputInside,
  compileFixture,
  ORIGIN,
  removeFixtureRoots
} from './helpers/compile-harness'
import {assetsFixture, NOTES_TXT, SMALL_SVG} from './helpers/fixtures'

afterAll(() => removeFixtureRoots())

const dataUri = (mime: string, bytes: Buffer | string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

const nameOf = (file: string, files: Record<string, string | Buffer>) =>
  bundledAssetOutputName(`/project/${file}`, Buffer.from(files[file]))

describe('compile harness', () => {
  it('refuses an output path outside the fixture', () => {
    const root = '/tmp/fixture'

    expect(() => assertOutputInside(root, undefined)).toThrow(
      'compile harness: output.path must be an absolute path inside /tmp/fixture, got undefined'
    )

    expect(() => assertOutputInside(root, 'dist')).toThrow(
      'compile harness: output.path must be an absolute path inside /tmp/fixture, got dist'
    )

    expect(() => assertOutputInside(root, root)).toThrow(
      'compile harness: output.path /tmp/fixture is not inside the fixture /tmp/fixture'
    )

    expect(() => assertOutputInside(root, '/tmp/elsewhere/dist')).toThrow(
      'compile harness: output.path /tmp/elsewhere/dist is not inside the fixture /tmp/fixture'
    )

    expect(assertOutputInside(root, '/tmp/fixture/dist')).toBe(
      '/tmp/fixture/dist'
    )
  })

  it('refuses a build whose config moves the output out of the fixture', async () => {
    const outside = path.join(process.cwd(), 'dist')

    await expect(
      compileFixture({
        files: {'index.js': 'self.out = {}\n'},
        plugins: [],
        config: () => ({output: {path: outside}})
      })
    ).rejects.toThrow(`compile harness: output.path ${outside} is not inside`)

    expect(fs.existsSync(outside)).toBe(false)
  })
})

describe('static assets through a real compile', () => {
  const files = assetsFixture(
    [
      "const smallViaNewUrl = new URL('./small.png', import.meta.url).href",
      "const clip = new URL('./clip.mp4', import.meta.url).href",
      "import largeSvg from './large.svg'"
    ],
    ['smallViaNewUrl', 'clip', 'largeSvg']
  )
  files['clip.mp4'] = Buffer.alloc(5000, 0x43)
  files['large.svg'] = `${SMALL_SVG}<!--${'x'.repeat(3000)}-->\n`

  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: emits each asset under its content-hashed name and returns the URL rspack wrote`, async () => {
      const build = await compileFixture({
        mode,
        files,
        plugins: [new StaticAssetsPlugin(), new WasmPlugin()]
      })

      expect(build.errors).toEqual([])
      expect(build.warnings).toEqual([])

      const large = nameOf('large.png', files)
      const small = nameOf('small.png', files)
      const font = nameOf('font.woff2', files)
      const clip = nameOf('clip.mp4', files)
      const largeSvg = nameOf('large.svg', files)

      // The names another emitter computes are the names rspack wrote.
      const assets = Object.keys(build.emitted).filter((name) =>
        name.startsWith('assets/')
      )
      expect(assets.sort()).toEqual([clip, font, large, largeSvg, small].sort())

      for (const name of [clip, font, large, largeSvg, small]) {
        expect(name).toMatch(/^assets\/[a-z]+\.[0-9a-f]{8}\.[a-z0-9]+$/)
      }

      const others = Object.keys(build.emitted)
        .filter((name) => !name.startsWith('assets/'))
        .sort()
      const [wasm, chunk] = [
        others.filter((name) => name.endsWith('.module.wasm')),
        others.filter((name) => name !== 'main.js' && name.endsWith('.js'))
      ]
      expect(others).toEqual([...wasm, ...chunk, 'main.js'].sort())
      expect(wasm).toEqual([
        expect.stringMatching(/^[0-9a-f]{16}\.module\.wasm$/)
      ])

      // The async chunk that loads the wasm module, named by rspack's id rules.
      expect(chunk).toEqual([
        mode === 'production'
          ? expect.stringMatching(/^[0-9]+\.js$/)
          : 'answer_wasm.js'
      ])

      const out = await build.evaluate()

      // 2048 bytes is the last size that inlines, 2049 is emitted.
      expect(out.small).toBe(dataUri('image/png', files['small.png']))
      expect(out.large).toBe(`/${large}`)
      expect(out.icon).toBe(dataUri('image/svg+xml', SMALL_SVG))
      expect(out.font).toBe(`/${font}`)
      expect(out.notes).toBe(dataUri('text/plain', NOTES_TXT))
      // ?url is a file URL whatever the size.
      expect(out.smallUrl).toBe(`/${small}`)
      expect(out.notesRaw).toBe(NOTES_TXT)
      expect(out.viaNewUrl).toBe(`${ORIGIN}${large}`)
      expect(out.wasmAnswer).toBe(42)
      // new URL() follows the same rules, and a file no rule claims (.mp4)
      // still lands under assets/ through output.assetModuleFilename.
      expect(out.smallViaNewUrl).toBe(dataUri('image/png', files['small.png']))
      expect(out.clip).toBe(`${ORIGIN}${clip}`)
      expect(out.largeSvg).toBe(`/${largeSvg}`)
    })
  }

  it('emits the same names in development and production', async () => {
    const [production, development] = await Promise.all(
      (['production', 'development'] as const).map((mode) =>
        compileFixture({
          mode,
          files,
          plugins: [new StaticAssetsPlugin(), new WasmPlugin()]
        })
      )
    )
    const assetsOf = (build: typeof production) =>
      Object.keys(build.emitted)
        .filter((name) => name.startsWith('assets/'))
        .sort()

    expect(assetsOf(development)).toEqual(assetsOf(production))
    expect(assetsOf(production)).toHaveLength(5)
  })
})
