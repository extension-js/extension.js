import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  cssUrlRefCandidates,
  cssUrlRefFiles,
  extractCssUrlRefs,
  isDeadCssUrlRef,
  replaceCssUrlRefs
} from '../../css-lib/dead-url-refs'
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

describe('the files a css url() request could name', () => {
  const posix = {
    issuerDir: '/project/src/content',
    roots: ['/project/public', '/project/src']
  }
  const win32 = {
    issuerDir: 'C:\\project\\src\\content',
    roots: ['C:\\project\\public', 'C:\\project\\src']
  }

  it.each([
    ['./a.png', ['/project/src/content/a.png']],
    ['../img/a.png', ['/project/src/img/a.png']],
    ['./a.png?x#y', ['/project/src/content/a.png']],
    ['./a.png#y?x', ['/project/src/content/a.png']],
    ['/img/a.png', ['/project/public/img/a.png', '/project/src/img/a.png']],
    ['/img/a.png?v=2', ['/project/public/img/a.png', '/project/src/img/a.png']],
    [
      'a.png',
      [
        '/project/src/content/a.png',
        '/project/public/a.png',
        '/project/src/a.png'
      ]
    ]
  ])('reads %s with forward slashes', (request, expected) => {
    expect(cssUrlRefCandidates(request, posix, path.posix)).toEqual(expected)
  })

  it.each([
    ['./a.png', ['C:\\project\\src\\content\\a.png']],
    ['../img/a.png', ['C:\\project\\src\\img\\a.png']],
    ['./a.png?x#y', ['C:\\project\\src\\content\\a.png']],
    [
      '/img/a.png',
      ['C:\\project\\public\\img\\a.png', 'C:\\project\\src\\img\\a.png']
    ],
    [
      'a.png',
      [
        'C:\\project\\src\\content\\a.png',
        'C:\\project\\public\\a.png',
        'C:\\project\\src\\a.png'
      ]
    ]
  ])('reads %s with backslashes', (request, expected) => {
    expect(cssUrlRefCandidates(request, win32, path.win32)).toEqual(expected)
  })

  it.each([
    ['an absolute URL', 'https://example.com/a.png'],
    ['a protocol-relative URL', '//example.com/a.png'],
    ['a data: URI', 'data:image/png;base64,AAAA'],
    ['a browser scheme', 'chrome-extension://id/a.png'],
    ['a Windows drive path', 'C:/project/a.png'],
    ['a scoped package', '@scope/pkg/a.png'],
    ['a tilde package', '~pkg/a.png'],
    ['a package sheet', 'some-pkg/styles.css'],
    ['a fragment alone', '#gradient'],
    ['a query alone', '?v=2'],
    ['nothing', '']
  ])('names no file for %s', (_label, request) => {
    expect(cssUrlRefCandidates(request, posix, path.posix)).toEqual([])
    expect(cssUrlRefCandidates(request, win32, path.win32)).toEqual([])
  })
})

// A commented-out url() is not a reference a browser requests.
// An @import may leave .css off, and both checks of a dead reference read
// the same list, so neither calls such an import dead while the other keeps it.
describe('the .css sheet an extensionless request can name', () => {
  // Resolved, so Windows reads the root path on the current drive too.
  const context = {
    issuerDir: path.resolve(path.sep, 'project', 'content'),
    roots: [path.resolve(path.sep, 'project', 'public')]
  }

  it('is listed after the file as written, for a relative and a root request', () => {
    expect(cssUrlRefFiles('./theme', context)).toEqual([
      path.resolve(path.sep, 'project', 'content', 'theme'),
      path.resolve(path.sep, 'project', 'content', 'theme.css')
    ])

    expect(cssUrlRefFiles('/theme?v=1', context)).toEqual([
      path.resolve(path.sep, 'project', 'public', 'theme'),
      path.resolve(path.sep, 'project', 'public', 'theme.css')
    ])
  })

  it('is not added to a request that names an extension', () => {
    expect(cssUrlRefFiles('./theme.png', context)).toEqual([
      path.resolve(path.sep, 'project', 'content', 'theme.png')
    ])
  })

  it('keeps the request alive when only the .css file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-sibling-'))
    tempDirs.push(dir)
    fs.writeFileSync(path.join(dir, 'theme.css'), '.theme{}')
    const here = {issuerDir: dir, roots: [dir]}

    expect(isDeadCssUrlRef('./theme', here)).toBe(false)
    expect(isDeadCssUrlRef('./other', here)).toBe(true)
  })
})

describe('an @import that names its sheet with a string', () => {
  it('is read as a reference, like one written with url()', () => {
    expect(
      extractCssUrlRefs(
        '@import "./a.css";\n@IMPORT \'./b.css\' screen;\n@import url(./c.css);\n.x{background:url(./d.png)}\n'
      )
    ).toEqual(['./c.css', './d.png', './a.css', './b.css'])
  })

  it('is skipped inside a comment, and when a loader built the request', () => {
    expect(
      extractCssUrlRefs(
        '/* @import "./gone.css"; */\n@import "/a/b.vue.css!=!./loader.js!./b.vue";\n'
      )
    ).toEqual([])
  })
})

describe('css url() refs inside comments', () => {
  it.each([
    ['a whole comment', '/* .x{background:url(./a.png)} */', []],
    [
      'a comment after a live reference',
      '.a{background:url(./b.png)} /* url(./c.png) */',
      ['./b.png']
    ],
    ['a comment left open', '.a{} /* url(./f.png)', []],
    [
      'comment markers inside strings',
      '.a{content:"/*"} .b{background:url(./d.png)} .c{content:\'*/\'}',
      ['./d.png']
    ],
    [
      'an escaped slash before a star',
      '.a\\/*b{background:url(./e.png)}',
      ['./e.png']
    ],
    [
      'a star slash inside a quoted url()',
      '.a{background:url("./g/*.png")} .b{background:url(./h.png)}',
      ['./g/*.png', './h.png']
    ],
    [
      'a slash star inside an unquoted url()',
      '.a{background:url(./i/*.png)} .b{background:url(./j.png)}',
      ['./i/*.png', './j.png']
    ]
  ])('reads %s', (_label, source, expected) => {
    expect(extractCssUrlRefs(source)).toEqual(expected)
  })
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

// A string is text, whatever it spells.
it('leaves a url( that is the text of a string as written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-css-'))
  tempDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'a.png'), 'image')

  expect(
    keepPublicRootRefs(
      '.a::before{content:"url(/a.png)"}\n.b{background:url(/a.png)}\n',
      dir
    )
  ).toBe(
    `.a::before{content:"url(/a.png)"}\n.b{background:url("${PUBLIC_ROOT_SCHEME}/a.png")}\n`
  )
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
