import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {cssInContentScriptLoader} from '../css-in-content-script-loader'
import {bundledFileToken} from '../css-lib/inline-content-script-css'
import {inlineCssImports} from '../css-lib/inline-css-imports'
import deadCssUrlLoader from '../dead-css-url-loader'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()
const WARN = '⏵⏵⏵'
const BOM = String.fromCharCode(0xfeff)

afterEach(() => {
  vi.unstubAllEnvs()
})

function inline(root: string, sheet: string) {
  const resourcePath = path.join(root, sheet)

  return inlineCssImports(fs.readFileSync(resourcePath, 'utf8'), {
    resourcePath,
    roots: [path.join(root, 'public'), root],
    projectPath: root
  })
}

// A content-script sheet reaches the page as a data: URL. A relative @import
// has no base there, so the browser fetches nothing and the rules are lost.
describe('the sheets a content-script sheet imports', () => {
  it('come in where the @import stood, in order', () => {
    const root = makeProject({
      'content/styles.css':
        '@import "./reset.css";\n@import url(./theme.css);\n.own{color:red}\n',
      'content/reset.css': '.reset{margin:0}\n',
      'content/theme.css': '.theme{color:blue}\n'
    })

    expect(inline(root, 'content/styles.css')).toEqual({
      css: '.reset{margin:0}\n\n.theme{color:blue}\n\n.own{color:red}\n',
      files: [
        path.join(root, 'content', 'reset.css'),
        path.join(root, 'content', 'theme.css')
      ],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      bare: [],
      cycles: []
    })
  })

  it('keep the conditions the @import carried', () => {
    const root = makeProject({
      'styles.css': [
        '@import "./print.css" print;',
        '@import "./grid.css" supports(display: grid) screen and (min-width: 40em);',
        '@import "./base.css" layer(base);',
        '@import "./anon.css" layer;',
        ''
      ].join('\n'),
      'print.css': '.p{}',
      'grid.css': '.g{}',
      'base.css': '.b{}',
      'anon.css': '.n{}'
    })

    expect(inline(root, 'styles.css').css).toBe(
      [
        '@media print {\n.p{}\n}',
        '@supports (display: grid) {\n@media screen and (min-width: 40em) {\n.g{}\n}\n}',
        '@layer base {\n.b{}\n}',
        '@layer {\n.n{}\n}',
        ''
      ].join('\n')
    )
  })

  it('bring in what they import, with each url() named from the first sheet', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/buttons.css";\n',
      'shared/buttons.css':
        '@import "./parts/icons.css";\n.button{background:url(img/bg.png)}\n',
      'shared/parts/icons.css':
        '.icon{background:url("./icon.svg#mark")}\n.remote{background:url(https://example.com/a.png)}\n.root{background:url(/img/root.png)}\n'
    })

    expect(inline(root, 'content/styles.css').css).toBe(
      [
        '.icon{background:url("../shared/parts/icon.svg#mark")}',
        '.remote{background:url(https://example.com/a.png)}',
        '.root{background:url(/img/root.png)}',
        '',
        '.button{background:url(../shared/img/bg.png)}',
        '',
        ''
      ].join('\n')
    )
  })

  it('are found from the public folder for a root path, and with .css left off', () => {
    const root = makeProject({
      'content/styles.css': '@import "/css/tokens.css";\n@import "./theme";\n',
      'public/css/tokens.css': ':root{--a:1}',
      'content/theme.css': '.theme{}'
    })

    expect(inline(root, 'content/styles.css').css).toBe(
      ':root{--a:1}\n.theme{}\n'
    )
  })

  it('come in once when two sheets import each other', () => {
    const root = makeProject({
      'a.css': '@import "./b.css";\n.a{}\n',
      'b.css': '@import "./a.css";\n.b{}\n'
    })

    const result = inline(root, 'a.css')

    expect(result.css).toBe('\n.b{}\n\n.a{}\n')
    expect(result.cycles).toEqual([
      [
        path.join(root, 'a.css'),
        path.join(root, 'b.css'),
        path.join(root, 'a.css')
      ]
    ])
  })

  // A url( in a string or a comment names no file, and a name can also sit
  // in a plain string where a function takes one.
  it('name each address from the first sheet, and leave text that only reads like one', () => {
    const root = makeProject({
      'styles.css': '@import "./sub/a.css";\n',
      'sub/a.css': [
        '.note::after{content:"see url(a.png)"}',
        '/* url(./in-comment.png) */',
        '@font-face{font-family:A;src:url(./a.woff2) format("woff2"),url(\'a.woff\')}',
        '.set{background:image-set("./a.png" 1x, url(b.png) 2x)}',
        '.set{background:-webkit-image-set( "c.png" 1x)}',
        ':root{--icon: url( ./icon.svg#mark )}',
        '.data{background:url(data:image/png;base64,AAAA)}',
        '.attr[title="url(a.png)"]{color:red}',
        ''
      ].join('\n')
    })

    expect(inline(root, 'styles.css').css).toBe(
      [
        '.note::after{content:"see url(a.png)"}',
        '/* url(./in-comment.png) */',
        '@font-face{font-family:A;src:url(./sub/a.woff2) format("woff2"),url(\'./sub/a.woff\')}',
        '.set{background:image-set("./sub/a.png" 1x, url(./sub/b.png) 2x)}',
        '.set{background:-webkit-image-set( "./sub/c.png" 1x)}',
        ':root{--icon: url( ./sub/icon.svg#mark )}',
        '.data{background:url(data:image/png;base64,AAAA)}',
        '.attr[title="url(a.png)"]{color:red}',
        '',
        ''
      ].join('\n')
    )
  })

  it('leave a sheet that sets an @namespace where it is, with the reason', () => {
    const root = makeProject({
      'styles.css': '@import "./svg.css";\n.own{}\n',
      'svg.css':
        '@namespace svg url(http://www.w3.org/2000/svg);\n@import "./more.css";\nsvg|a{}\n',
      'more.css': '.more{}\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: '@import "./svg.css";\n.own{}\n',
      files: [],
      missing: [],
      unreadable: [
        {
          request: './svg.css',
          file: path.join(root, 'svg.css'),
          reason:
            'The file sets an @namespace, which reads differently once its rules sit in another stylesheet.',
          fix: 'Import that file from the script instead, or move its @namespace rules out of it.'
        }
      ],
      moved: [],
      skipped: [],
      bare: [],
      cycles: []
    })
  })

  it('bring nothing into a sheet that sets an @namespace of its own', () => {
    const source =
      '@import "./a.css";\n@namespace svg url(http://www.w3.org/2000/svg);\n@import "./b.css";\nsvg|a{}\n'
    const root = makeProject({
      'styles.css': source,
      'a.css': '.a{}\n',
      'b.css': '.b{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(source)
    expect(result.files).toEqual([])
    expect(result.unreadable).toEqual([
      {
        request: './a.css',
        file: path.join(root, 'a.css'),
        reason:
          'This stylesheet sets an @namespace, which has to come before every rule, so no imported rules can come in ahead of it.',
        fix: 'Import that file from the script instead, or move the @namespace rules to a sheet of their own.'
      }
    ])
  })

  const KEEP =
    'Keep the sheets a content script stylesheet imports inside the project, outside node_modules and folders that start with a dot.'

  it.each([
    [
      'outside the project',
      '../outside.css',
      'The file is outside the project.'
    ],
    [
      'in node_modules',
      './node_modules/pkg/x.css',
      'The file belongs to a package in node_modules.'
    ],
    [
      'in a folder that starts with a dot',
      './.cache/x.css',
      'The file is inside .cache, a folder the build does not read.'
    ]
  ])('leave a sheet %s where it is, with the reason', (_label, request, reason) => {
    const root = makeProject({
      'outside.css': '.outside{}\n',
      'app/styles.css': `@import "${request}";\n@import "./ok.css";\n.own{}\n`,
      'app/ok.css': '.ok{}\n',
      'app/node_modules/pkg/x.css': '.pkg{}\n',
      'app/.cache/x.css': '.cache{}\n'
    })
    const app = path.join(root, 'app')
    const result = inlineCssImports(
      fs.readFileSync(path.join(app, 'styles.css'), 'utf8'),
      {
        resourcePath: path.join(app, 'styles.css'),
        roots: [path.join(app, 'public'), app],
        projectPath: app
      }
    )

    expect(result.css).toBe(`@import "${request}";\n.ok{}\n\n.own{}\n`)
    expect(result.unreadable).toEqual([
      {request, file: path.resolve(app, request), reason, fix: KEEP}
    ])
  })

  // Windows asks for a privilege to make a link, so these run where it is free.
  describe.skipIf(process.platform === 'win32')('through a link', () => {
    it('leave a sheet whose real file is outside the project', () => {
      const root = makeProject({
        'outside.css': '.outside{}\n',
        'app/styles.css': '@import "./linked.css";\n.own{}\n'
      })
      const app = path.join(root, 'app')

      fs.symlinkSync(
        path.join(root, 'outside.css'),
        path.join(app, 'linked.css')
      )

      const result = inlineCssImports(
        fs.readFileSync(path.join(app, 'styles.css'), 'utf8'),
        {
          resourcePath: path.join(app, 'styles.css'),
          roots: [path.join(app, 'public'), app],
          projectPath: app
        }
      )

      expect(result.css).toBe('@import "./linked.css";\n.own{}\n')
      expect(result.unreadable.map((left) => left.reason)).toEqual([
        'The file is outside the project.'
      ])
    })

    it('bring a sheet in once when a folder links back to itself', () => {
      const root = makeProject({
        'styles.css': '@import "./a.css";\n.own{}\n',
        'a.css': '@import "./loop/a.css";\n.a{}\n'
      })

      fs.symlinkSync(root, path.join(root, 'loop'), 'dir')

      const result = inline(root, 'styles.css')

      expect(result.css).toBe('\n.a{}\n\n.own{}\n')
      expect(result.cycles).toEqual([
        [path.join(root, 'a.css'), path.join(root, 'a.css')]
      ])
    })
  })

  // The tools read a name with no ./ ahead of it as a package, and so does
  // this step, whatever file sits beside the sheet.
  it('read a name with no ./ ahead of it as a package, never as a file beside the sheet', () => {
    const source = '@import "tailwindcss";\n@import "other.css";\n.own{}\n'
    const root = makeProject({
      'styles.css': source,
      'tailwindcss.css': '.local{}\n',
      'other.css': '.other{}\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: source,
      files: [],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      // Only the name that spells a file out is worth a word.
      bare: [
        {
          statement: '@import "other.css";',
          file: path.join(root, 'styles.css')
        }
      ],
      cycles: []
    })
  })

  // An @import that follows a rule is skipped by the browser and by the
  // tools, so each one that stays leads the sheet the others came into.
  it('move an import that stays to the head of the sheet', () => {
    const root = makeProject({
      'styles.css':
        '@import "./local.css";\n@import url(https://fonts.example.com/css?family=A);\n@import "tailwindcss";\n.own{}\n',
      'local.css': '@import "https://example.com/nested.css";\n.local{}\n'
    })

    expect(inline(root, 'styles.css').css).toBe(
      [
        '@import "https://example.com/nested.css";',
        '@import url(https://fonts.example.com/css?family=A);',
        '@import "tailwindcss";',
        '',
        '.local{}',
        '',
        '',
        '',
        '.own{}',
        ''
      ].join('\n')
    )
  })

  it('say which import now leads rules it used to follow', () => {
    const root = makeProject({
      'styles.css':
        '@import "https://example.com/first.css";\n@import "./local.css";\n@import "tailwindcss";\n.own{}\n',
      'local.css': '.local{}\n'
    })

    expect(inline(root, 'styles.css').moved).toEqual([
      {
        statement: '@import "tailwindcss";',
        file: path.join(root, 'styles.css')
      }
    ])
  })

  // The parser drops the mark and counts every place from the text after it.
  it('come in whole when the sheet opens with a byte order mark', () => {
    const root = makeProject({
      'styles.css': `${BOM}@import "./a.css";\n.own{}\n`,
      'a.css': `${BOM}.a{}\n`
    })

    expect(inline(root, 'styles.css').css).toBe('.a{}\n\n.own{}\n')
  })

  it('come in whole when the lines end in a carriage return and a line feed', () => {
    const root = makeProject({
      'styles.css':
        '@import "./a.css";\r\n@import "https://example.com/x.css";\r\n.own{}\r\n',
      'a.css': '@import "./b.css";\r\n.a{}\r\n',
      'b.css': '.b{}\r\n'
    })

    expect(inline(root, 'styles.css').css).toBe(
      '@import "https://example.com/x.css";\n.b{}\r\n\r\n.a{}\r\n\r\n\r\n.own{}\r\n'
    )
  })

  // An import that stays is never dropped: it leads the sheet under the
  // conditions of the imports that brought its own sheet in.
  it('keep an import that stays, under the condition its sheet came in with', () => {
    const root = makeProject({
      'styles.css': '@import "./a.css" screen;\n',
      'a.css': '@import "./b.css";\n',
      'b.css':
        '@import "https://fonts.example.com/x.css";\n@import "./gone.css";\n.b{}\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: [
        '@import "https://fonts.example.com/x.css" screen;',
        '@import "./gone.css" screen;',
        '@media screen {',
        '\n\n.b{}\n\n',
        '}',
        ''
      ].join('\n'),
      files: [path.join(root, 'b.css'), path.join(root, 'a.css')],
      missing: [path.join(root, 'gone.css')],
      unreadable: [],
      moved: [],
      skipped: [],
      bare: [],
      cycles: []
    })
  })

  it.each([
    [
      'a media query and a feature',
      'screen',
      '(min-width: 600px)',
      'screen and (min-width: 600px)'
    ],
    [
      'two supports conditions',
      'supports(display: grid)',
      'supports(not (display: flex))',
      'supports((display: grid) and (not (display: flex)))'
    ],
    [
      'a layer inside a layer',
      'layer(base)',
      'layer(fonts)',
      'layer(base.fonts)'
    ],
    [
      'every kind at once',
      'layer(base) supports(display: grid) print',
      '(orientation: landscape)',
      'layer(base) supports(display: grid) print and (orientation: landscape)'
    ]
  ])('join %s on an import that stays', (_label, outer, own, joined) => {
    const root = makeProject({
      'styles.css': `@import "./a.css" ${outer};\n`,
      'a.css': `@import url(https://example.com/x.css) ${own};\n.a{}\n`
    })
    const result = inline(root, 'styles.css')

    expect(result.css.split('\n')[0]).toBe(
      `@import "https://example.com/x.css" ${joined};`
    )

    expect(result.css).not.toContain('url(https://example.com/x.css)')
    expect(result.skipped).toEqual([])
  })

  it.each([
    ['an unnamed layer', 'layer', 'layer(fonts)'],
    ['two lists of media queries', 'screen, print', '(min-width: 600px)'],
    ['two media types', 'screen', 'print'],
    ['a function CSS does not define', 'screen', 'theme(reference)']
  ])('leave an import in place, and say so, under %s', (_label, outer, own) => {
    const root = makeProject({
      'styles.css': `@import "./a.css" ${outer};\n.own{}\n`,
      'a.css': `@import "https://example.com/x.css" ${own};\n.a{}\n`
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toContain(
      `{\n@import "https://example.com/x.css" ${own};\n.a{}\n\n}`
    )

    expect(result.skipped).toEqual([
      {
        statement: `@import "https://example.com/x.css" ${own};`,
        file: path.join(root, 'a.css')
      }
    ])

    expect(result.moved).toEqual([])
  })

  // A browser reads @charset and a list of layer names ahead of an @import,
  // and the list is what sets the order of the layers.
  it('place an import that stays after the opening @charset and layer names', () => {
    const root = makeProject({
      'styles.css':
        '@charset "utf-8";\n/* order */\n@layer reset, theme;\n@import "./reset.css" layer(reset);\n@import "https://cdn.example.com/x.css" layer(theme);\n.own{}\n',
      'reset.css': '.reset{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(
      [
        '@charset "utf-8";',
        '/* order */',
        '@layer reset, theme;',
        '@import "https://cdn.example.com/x.css" layer(theme);',
        '@layer reset {',
        '.reset{}',
        '',
        '}',
        '',
        '.own{}',
        ''
      ].join('\n')
    )

    // The list already fixed where each layer sits, so nothing changed.
    expect(result.moved).toEqual([])
  })

  // The list is what sets the order of the layers, so an import that goes
  // to the head takes along each list it followed in its own sheet.
  it.each([
    [
      'with no condition',
      '',
      [
        '@layer base, theme;',
        '@import "https://cdn.example.com/x.css" layer(theme);',
        '',
        '',
        '.a{}',
        '',
        '.own{}',
        ''
      ]
    ],
    [
      'under a named layer',
      ' layer(ui)',
      [
        '@layer ui.base, ui.theme;',
        '@import "https://cdn.example.com/x.css" layer(ui.theme);',
        '@layer ui {',
        '',
        '',
        '.a{}',
        '',
        '}',
        '.own{}',
        ''
      ]
    ]
  ])('take the list of layer names of an imported sheet to the head, %s', (_label, outer, lines) => {
    const root = makeProject({
      'content/styles.css': `@import "./a.css"${outer};\n.own{}\n`,
      'content/a.css':
        '@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n.a{}\n'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe(lines.join('\n'))
    expect(result.moved).toEqual([])
  })

  it.each([
    ['a media query', 'screen', 'layer(theme) screen'],
    [
      'a supports condition',
      'supports(display: grid)',
      'layer(theme) supports(display: grid)'
    ]
  ])('say an import left its list of layer names behind under %s', (_label, outer, joined) => {
    const root = makeProject({
      'content/styles.css': `@import "./a.css" ${outer};\n.own{}\n`,
      'content/a.css':
        '@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n.a{}\n'
    })
    const result = inline(root, 'content/styles.css')
    const statement = `@import "https://cdn.example.com/x.css" ${joined};`

    expect(result.css.split('\n')[0]).toBe(statement)
    expect(result.css).toContain('{\n@layer base, theme;\n\n.a{}\n\n}')
    expect(result.moved).toEqual([
      {statement, file: path.join(root, 'content', 'a.css')}
    ])
  })

  it('say an import now leads a list of layer names the first sheet wrote after an import', () => {
    const root = makeProject({
      'styles.css':
        '@import "./a.css";\n@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n',
      'a.css': '.a{}\n'
    })
    const result = inline(root, 'styles.css')

    expect(result.css).toBe(
      '@layer base, theme;\n@import "https://cdn.example.com/x.css" layer(theme);\n.a{}\n\n\n\n'
    )

    expect(result.moved).toEqual([
      {
        statement: '@import "https://cdn.example.com/x.css" layer(theme);',
        file: path.join(root, 'styles.css')
      }
    ])
  })

  // The opening list says which layer wins, and inside one layer the later
  // source still wins, so an import moved ahead of rules in its own layer
  // changes the result.
  it.each([
    ['the same layer', 'layer(theme)', '.btn{color:red}\n'],
    ['a layer block the sheet opens', '', '@layer theme{.btn{color:red}}\n'],
    ['a parent of the layer', 'layer(theme)', '.btn{color:red}\n', 'theme.cdn']
  ])('say an import moved past rules that came into %s', (_label, how, local, layer = 'theme') => {
    const root = makeProject({
      'styles.css': `@layer theme;\n@import "./local.css" ${how};\n@import "https://cdn.example.com/x.css" layer(${layer});\n`,
      'local.css': local
    })
    const result = inline(root, 'styles.css')

    expect(result.moved).toEqual([
      {
        statement: `@import "https://cdn.example.com/x.css" layer(${layer});`,
        file: path.join(root, 'styles.css')
      }
    ])
  })

  it('name an import that stays from the first sheet, not the one it was in', () => {
    const root = makeProject({
      'content/styles.css': '@import "../shared/a.css";\n.own{}\n',
      'shared/a.css':
        '@import "./later.css?v=2" print;\n@import "./vars.scss";\n.a{}\n',
      'shared/vars.scss': '$a: 1;'
    })
    const result = inline(root, 'content/styles.css')

    expect(result.css).toBe(
      [
        '@import "../shared/later.css?v=2" print;',
        '@import "../shared/vars.scss";',
        '',
        '',
        '.a{}',
        '',
        '.own{}',
        ''
      ].join('\n')
    )

    expect(result.missing).toEqual([path.join(root, 'shared', 'later.css')])
  })

  it.each([
    ['a package', '@import "tailwindcss";\n.own{}\n'],
    ['an alias', '@import "~pkg/style.css";\n.own{}\n'],
    ['a function CSS does not define', '@import "./a.css" theme(reference);\n'],
    ['an import after a rule', '.own{}\n@import "./a.css";\n'],
    ['a Sass file', '@import "./vars.scss";\n.own{}\n'],
    ['a sheet that does not parse', '@import "./a.css";\n.own{color:red\n']
  ])('leave %s as written', (_label, source) => {
    const root = makeProject({
      'styles.css': source,
      'a.css': '.a{}',
      'vars.scss': '$a: 1;'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: source,
      files: [],
      missing: [],
      unreadable: [],
      moved: [],
      skipped: [],
      bare: [],
      cycles: []
    })
  })

  it('name every place a sheet that is not there could appear', () => {
    const root = makeProject({
      'content/styles.css': '@import "./gone.css";\n@import "/later";\n'
    })

    expect(inline(root, 'content/styles.css')).toEqual({
      css: '@import "./gone.css";\n@import "/later";\n',
      files: [],
      missing: [
        path.join(root, 'content', 'gone.css'),
        path.join(root, 'public', 'later'),
        path.join(root, 'later'),
        path.join(root, 'public', 'later.css'),
        path.join(root, 'later.css')
      ],
      unreadable: [],
      moved: [],
      skipped: [],
      bare: [],
      cycles: []
    })
  })

  it('name an imported sheet that is not valid CSS, and leave its @import', () => {
    const root = makeProject({
      'styles.css': '@import "./broken.css";\n.own{}\n',
      'broken.css': '.a{color:red\n'
    })

    expect(inline(root, 'styles.css')).toEqual({
      css: '@import "./broken.css";\n.own{}\n',
      files: [],
      missing: [],
      unreadable: [
        {
          request: './broken.css',
          file: path.join(root, 'broken.css'),
          reason: 'The file is not valid CSS.'
        }
      ],
      moved: [],
      skipped: [],
      bare: [],
      cycles: []
    })
  })
})

function runLoader(
  root: string,
  sheet: string,
  options: {inlineImports?: boolean} = {}
) {
  const resourcePath = path.join(root, sheet)
  const warnings: Error[] = []
  const errors: Error[] = []
  const watched: string[] = []
  const awaited: string[] = []
  const output = deadCssUrlLoader.call(
    {
      resourcePath,
      getOptions: () => ({
        manifestPath: path.join(root, 'manifest.json'),
        projectPath: root,
        ...options
      }),
      emitWarning: (warning: Error) => warnings.push(warning),
      emitError: (error: Error) => errors.push(error),
      addDependency: (file: string) => watched.push(file),
      addMissingDependency: (file: string) => awaited.push(file),
      _compilation: {warnings, errors}
    } as never,
    fs.readFileSync(resourcePath, 'utf8')
  )

  return {output, warnings, errors, watched, awaited}
}

describe('the loader run that brings imports into a content-script sheet', () => {
  it('answers with CSS and watches each sheet that came in', () => {
    const root = makeProject({
      'content/styles.css': '@import "./other.css";\n.own{color:red}\n',
      'content/other.css': '.imported{color:green}\n'
    })

    const {output, warnings, watched} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('.imported{color:green}\n\n.own{color:red}\n')
    expect(watched).toEqual([path.join(root, 'content', 'other.css')])
    expect(warnings).toEqual([])
  })

  it('warns once, with the reason, for an imported sheet it cannot read', () => {
    const root = makeProject({
      'content/styles.css': '@import "./broken.css";\n.own{}\n',
      'content/broken.css': '.a{color:red\n'
    })

    const {output, warnings, watched} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('@import "./broken.css";\n.own{}\n')
    expect(watched).toEqual([path.join(root, 'content', 'broken.css')])
    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Couldn't bring an @import into this content script stylesheet, so it stayed as written.`,
          'PATH content/styles.css',
          'IMPORT ./broken.css',
          'REASON The file is not valid CSS.',
          'A content script stylesheet loads from a data: URL, where the browser fetches no relative import.',
          'Fix the imported file so its rules ship with this stylesheet.'
        ].join('\n')
      ]
    ])
  })

  it('warns with the reason for a sheet it may not read, and still watches it', () => {
    const root = makeProject({
      'content/styles.css': '@import "../node_modules/pkg/x.css";\n.own{}\n',
      'node_modules/pkg/x.css': '.pkg{}\n'
    })

    const {output, warnings, watched} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('@import "../node_modules/pkg/x.css";\n.own{}\n')
    expect(watched).toEqual([path.join(root, 'node_modules', 'pkg', 'x.css')])
    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Couldn't bring an @import into this content script stylesheet, so it stayed as written.`,
          'PATH content/styles.css',
          'IMPORT ../node_modules/pkg/x.css',
          'REASON The file belongs to a package in node_modules.',
          'A content script stylesheet loads from a data: URL, where the browser fetches no relative import.',
          'Keep the sheets a content script stylesheet imports inside the project, outside node_modules and folders that start with a dot.'
        ].join('\n')
      ]
    ])
  })

  it('warns once for sheets that import one another', () => {
    const root = makeProject({
      'content/styles.css': '@import "./a.css";\n.own{}\n',
      'content/a.css': '@import "./b.css";\n.a{}\n',
      'content/b.css': '@import "./a.css";\n@import "./a.css";\n.b{}\n'
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('\n\n.b{}\n\n.a{}\n\n.own{}\n')
    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Sheets this content script stylesheet brings in with @import import one another, so the import that closes the loop was dropped.`,
          'PATH content/styles.css',
          'LOOP content/a.css > content/b.css > content/a.css',
          'Each sheet came in once, where it was first imported.',
          'Remove one of these @import rules to say which sheet comes first.'
        ].join('\n')
      ]
    ])
  })

  it('warns for a name with no ./ that a file beside the sheet also has', () => {
    const root = makeProject({
      'content/styles.css': '@import "other.css";\n.own{}\n',
      'content/other.css': '.other{}\n'
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe('@import "other.css";\n.own{}\n')
    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} An @import in this content script stylesheet names a package, and a file by that name sits beside the sheet.`,
          'PATH content/styles.css',
          'IMPORT @import "other.css";',
          'A name with no ./ ahead of it is looked up as a package, so the rules of that file did not come in.',
          'Start the name with ./ to bring the file in.'
        ].join('\n')
      ]
    ])
  })

  it('warns once for an import that now leads rules it used to follow', () => {
    const root = makeProject({
      'content/styles.css':
        '@import "./other.css";\n@import "https://example.com/x.css";\n@import "https://example.com/x.css";\n.own{}\n',
      'content/other.css': '.imported{}\n'
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe(
      '@import "https://example.com/x.css";\n@import "https://example.com/x.css";\n.imported{}\n\n\n\n.own{}\n'
    )

    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} Moved an @import to the top of this content script stylesheet, ahead of rules it used to follow.`,
          'PATH content/styles.css',
          'IMPORT @import "https://example.com/x.css";',
          'The sheets imported before it are now rules in this file, and a browser skips an @import that follows a rule.',
          'Write this @import first, or set the order with @layer, to keep the cascade you wrote.'
        ].join('\n')
      ]
    ])
  })

  it('warns once for an import left in a block, where a browser skips it', () => {
    const root = makeProject({
      'content/styles.css': '@import "./parts/other.css" layer;\n.own{}\n',
      'content/parts/other.css':
        '@import "https://example.com/x.css";\n.imported{}\n'
    })

    const {output, warnings} = runLoader(root, 'content/styles.css', {
      inlineImports: true
    })

    expect(output).toBe(
      '@layer {\n@import "https://example.com/x.css";\n.imported{}\n\n}\n.own{}\n'
    )

    expect(warnings.map((w) => [w.name, w.message])).toEqual([
      [
        'CssParseWarning',
        [
          `${WARN} An @import in a sheet this content script stylesheet imports will not load.`,
          'PATH content/styles.css',
          'IMPORT @import "https://example.com/x.css";',
          'WRITTEN IN content/parts/other.css',
          'Its sheet came in under a layer, media or supports condition this import cannot carry, and a browser skips an @import inside a block.',
          'Move this @import to the content script stylesheet itself.'
        ].join('\n')
      ]
    ])
  })

  it('reports an import that stays from a sheet two imports down', () => {
    const root = makeProject({
      'content/styles.css': '@import "./a.css" screen;\n',
      'content/a.css': '@import "./b.css";\n',
      'content/b.css': '@import "./gone.css";\n.b{}\n'
    })

    const first = runLoader(root, 'content/styles.css', {inlineImports: true})

    expect(first.awaited).toEqual([path.join(root, 'content', 'gone.css')])
    expect(first.output.split('\n')[0]).toBe('@import "./gone.css" screen;')

    fs.writeFileSync(path.join(root, 'content', 'styles.css'), first.output)

    const second = runLoader(root, 'content/styles.css')

    expect(second.warnings.map((report) => report.name)).toEqual(['CssDeadRef'])
    expect(second.warnings[0].message).toContain('NOT FOUND ./gone.css')
  })

  it.each([
    ['false', 'warnings'],
    ['true', 'errors']
  ] as const)('reports an @import of a file that is nowhere, strict refs %s', (strict, sink) => {
    vi.stubEnv('EXTENSION_STRICT_REFS', strict)
    const root = makeProject({
      'content/styles.css': '@import "./gone.css";\n.own{}\n'
    })

    const first = runLoader(root, 'content/styles.css', {inlineImports: true})
    const second = runLoader(root, 'content/styles.css')

    expect(first.awaited).toEqual([path.join(root, 'content', 'gone.css')])
    expect(second[sink].map((report) => report.name)).toEqual(['CssDeadRef'])
    expect(second[sink][0].message).toContain('NOT FOUND ./gone.css')
    expect(second[sink === 'errors' ? 'warnings' : 'errors']).toEqual([])
  })
})

// The processed text the runtime stylesheet module keeps as one literal.
function emittedSheet(distDir: string): string {
  for (const entry of fs.readdirSync(distDir, {recursive: true}) as string[]) {
    if (!entry.endsWith('.js')) continue

    const js = fs.readFileSync(path.join(distDir, entry), 'utf8')
    const literal = js.match(/__extjsCssText = ("(?:[^"\\]|\\.)*")/)
    if (literal) return JSON.parse(literal[1])
  }

  throw new Error(`No content-script sheet was emitted under ${distDir}`)
}

async function compileContentScript(root: string): Promise<string> {
  // The rules name the compiled loaders, which only the compile step writes.
  const loader = resolveDevelopDistFile('dead-css-url-loader')

  if (!fs.existsSync(loader)) {
    throw new Error(
      `This spec compiles with the loaders in programs/develop/dist and ${loader} is missing. ` +
        'Run `pnpm --filter extension-develop compile` first.'
    )
  }

  const rules = await cssInContentScriptLoader(
    root,
    path.join(root, 'manifest.json'),
    'production'
  )
  const distDir = path.join(root, 'out')
  const compiler = rspack({
    context: root,
    mode: 'production',
    devtool: false,
    entry: {
      'content/scripts': {
        import: path.join(root, 'content', 'scripts.js'),
        layer: 'extensionjs-content-script'
      }
    },
    output: {path: distDir, filename: '[name].js'},
    module: {rules},
    optimization: {minimize: false}
  })

  const errors = await new Promise<string[]>((resolve, reject) =>
    compiler.run((error, stats) =>
      compiler.close(() =>
        error || !stats
          ? reject(error)
          : resolve(
              [...stats.compilation.errors, ...stats.compilation.warnings].map(
                (issue) => issue.message
              )
            )
      )
    )
  )

  expect(errors).toEqual([])

  return emittedSheet(distDir)
}

const SCRIPT =
  "import href from './styles.css'\ndocument.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}))\n"

describe('a content script that imports a sheet with an @import, compiled', () => {
  it('ships the imported rules in the one sheet, with its url() as a bundled file', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css': '@import "./parts/other.css";\n.own{color:red}\n',
      'content/parts/other.css': '.imported{background:url(./icon.png)}\n',
      'content/parts/icon.png': 'image'
    })

    expect(await compileContentScript(root)).toBe(
      `.imported{background:url("${bundledFileToken(0)}")}\n\n.own{color:red}\n`
    )
  }, 60_000)

  // The bundler drops the mark of the file it reads, and the sheets that
  // file imports are read here, mark and all.
  it('ships every rule of a sheet that opens with a byte order mark', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css': `${BOM}@import "./other.css";\n.own{color:red}\n`,
      'content/other.css': `${BOM}.imported{color:green}\n`
    })

    expect(await compileContentScript(root)).toBe(
      '.imported{color:green}\n\n.own{color:red}\n'
    )
  }, 60_000)

  it('runs the imported rules through the PostCSS config of the project', async () => {
    const root = makeProject({
      'content/scripts.js': SCRIPT,
      'content/styles.css': '@import "./other.css";\n.own{color:red}\n',
      'content/other.css': '.imported{color:green}\n',
      'postcss.config.cjs': [
        'module.exports = {',
        '  plugins: [',
        '    {',
        "      postcssPlugin: 'marker',",
        '      Rule(rule) {',
        "        rule.prepend({prop: '--seen', value: 'yes'})",
        '      }',
        '    }',
        '  ]',
        '}',
        ''
      ].join('\n')
    })

    const sheet = await compileContentScript(root)

    expect(sheet).not.toContain('@import')
    expect(sheet.replace(/\s+/g, '')).toBe(
      '.imported{--seen:yes;color:green}.own{--seen:yes;color:red}'
    )
  }, 60_000)
})
