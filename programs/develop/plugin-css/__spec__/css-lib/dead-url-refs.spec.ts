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

const SPELLINGS = [
  '/images/x.png',
  '../public/images/x.png',
  './../public/images/x.png'
]

function createProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-css-'))
  tempDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'public', 'images'), {recursive: true})
  fs.mkdirSync(path.join(dir, 'content'), {recursive: true})
  fs.mkdirSync(path.join(dir, 'local'), {recursive: true})
  fs.writeFileSync(path.join(dir, 'public', 'images', 'x.png'), 'image')
  fs.writeFileSync(path.join(dir, 'public', 'theme.css'), '.t {}')
  fs.writeFileSync(path.join(dir, 'local', 'y.png'), 'image')

  return {
    dir,
    publicRoot: path.join(dir, 'public'),
    relative: {
      issuerDir: path.join(dir, 'content'),
      publicDir: path.join(dir, 'public')
    }
  }
}

describe('a stylesheet one folder deep names a public-owned file by its root path', () => {
  for (const spelling of SPELLINGS) {
    it(`rewrites url('${spelling}') to the one public path`, () => {
      const {publicRoot, relative} = createProject()

      expect(
        keepPublicRootRefs(
          `.a { background: url('${spelling}'); }`,
          publicRoot,
          relative
        )
      ).toBe(`.a { background: url("${PUBLIC_ROOT_SCHEME}/images/x.png"); }`)
    })
  }

  it('carries the query and the fragment of a relative reference over', () => {
    const {publicRoot, relative} = createProject()

    expect(
      keepPublicRootRefs(
        '.a { background: url("../public/images/x.png?v=2#frag"); }',
        publicRoot,
        relative
      )
    ).toBe(
      `.a { background: url("${PUBLIC_ROOT_SCHEME}/images/x.png?v=2#frag"); }`
    )
  })

  it('matches a symlink-resolved stylesheet folder against the folder as configured', () => {
    const {dir, publicRoot, relative} = createProject()
    const issuerDir = path.join(fs.realpathSync.native(dir), 'content')

    expect(
      keepPublicRootRefs(
        '.a { background: url(../public/images/x.png); }',
        publicRoot,
        {...relative, issuerDir}
      )
    ).toBe(`.a { background: url("${PUBLIC_ROOT_SCHEME}/images/x.png"); }`)
  })

  it('leaves a relative reference to a file outside the public folder as authored', () => {
    const {publicRoot, relative} = createProject()
    const source = '.a { background: url("../local/y.png"); }'

    expect(keepPublicRootRefs(source, publicRoot, relative)).toBe(source)
  })

  it('leaves a relative reference to a missing public file as authored', () => {
    const {publicRoot, relative} = createProject()
    const source = '.a { background: url("../public/images/missing.png"); }'

    expect(keepPublicRootRefs(source, publicRoot, relative)).toBe(source)
  })

  it('leaves a relative @import to be bundled into the sheet', () => {
    const {publicRoot, relative} = createProject()
    const source = '@import url("../public/theme.css");'

    expect(keepPublicRootRefs(source, publicRoot, relative)).toBe(source)
  })

  it('leaves a relative reference as authored when no public folder ships', () => {
    const {publicRoot} = createProject()
    const source = '.a { background: url("../public/images/x.png"); }'

    expect(keepPublicRootRefs(source, publicRoot)).toBe(source)
  })
})
