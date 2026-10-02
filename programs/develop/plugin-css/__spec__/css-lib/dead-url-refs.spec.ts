import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {extractCssUrlRefs, replaceCssUrlRefs} from '../../css-lib/dead-url-refs'
import {
  keepPublicRootRefs,
  PUBLIC_ROOT_SCHEME
} from '../../public-css-url-loader'

const CASINGS = ['url', 'URL', 'Url', 'uRl']

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, {recursive: true, force: true})

  tempDirs.length = 0
})

describe('css url() refs are read case-insensitively, the way CSS is', () => {
  for (const casing of CASINGS) {
    it(`extracts every reference written ${casing}()`, () => {
      const source = [
        `.a { background: ${casing}(./icon.png); }`,
        `.b { background: ${casing}("/logo.png"); }`,
        `@font-face { src: ${casing}('./a.woff2') format("woff2"); }`
      ].join('\n')

      expect(extractCssUrlRefs(source)).toEqual([
        './icon.png',
        '/logo.png',
        './a.woff2'
      ])
    })

    it(`rewrites every reference written ${casing}() to the same output`, () => {
      const source = `.a { background: ${casing}(./icon.png); }`
      const rewritten = replaceCssUrlRefs(source, (request) =>
        request === './icon.png' ? 'assets/icon.png' : undefined
      )

      expect(rewritten).toBe('.a { background: url("assets/icon.png"); }')
    })

    it(`keeps a public-owned root path written ${casing}() as authored`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-css-'))
      tempDirs.push(dir)
      fs.writeFileSync(path.join(dir, 'logo.png'), 'image')

      expect(
        keepPublicRootRefs(`.a { background: ${casing}(/logo.png); }`, dir)
      ).toBe(`.a { background: url("${PUBLIC_ROOT_SCHEME}/logo.png"); }`)
    })
  }
})
