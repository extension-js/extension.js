import {describe, expect, it} from 'vitest'
import {
  CHROMIUM_EXTENSION_ROOT,
  firstPageRelativeTarget,
  GECKO_EXTENSION_ROOT,
  injectedSheetRoot,
  inlinedInjectedSheet,
  isInjectedSheet,
  leadingSheetImports,
  namedInjectedSheets,
  noteNamedInjectedSheet,
  notePublicInjectedSheet,
  publicInjectedSheets,
  rootedAtExtension,
  rootedAtExtensionFrom,
  type SkippedSheetImport
} from '../injected-sheet-urls'

describe('the url() targets of a sheet Chromium injects', () => {
  it('names a target at the output root from the extension', () => {
    expect(
      rootedAtExtension('.a{background-image:url(/assets/pic.4003208d.svg)}')
    ).toBe(
      `.a{background-image:url("${CHROMIUM_EXTENSION_ROOT}assets/pic.4003208d.svg")}`
    )
  })

  it('reads the three ways a sheet spells a url()', () => {
    const css = [
      '.a { background: url("/assets/a.png"); }',
      ".b { background: url('/assets/b.png?v=1#frag'); }",
      '.c { background: url( /assets/c.png ); }'
    ].join('\r\n')

    expect(rootedAtExtension(css)).toBe(
      [
        `.a { background: url("${CHROMIUM_EXTENSION_ROOT}assets/a.png"); }`,
        `.b { background: url("${CHROMIUM_EXTENSION_ROOT}assets/b.png?v=1#frag"); }`,
        `.c { background: url("${CHROMIUM_EXTENSION_ROOT}assets/c.png"); }`
      ].join('\r\n')
    )
  })

  it('leaves every target that is not at the output root as written', () => {
    const css = [
      '.a{background:url(//cdn.example.com/a.png)}',
      '.b{background:url(https://example.com/b.png)}',
      '.c{background:url(data:image/png;base64,AAAA)}',
      '.d{background:url(../assets/d.png)}',
      '.e{background:url(#gradient)}',
      `.f{background:url("${CHROMIUM_EXTENSION_ROOT}assets/f.png")}`
    ].join('\n')

    expect(rootedAtExtension(css)).toBe(css)
  })

  it('gives a sheet with no url() back byte for byte', () => {
    const css = '.a{color:#0101c8}\r\n/*# sourceMappingURL=content-0.css.map*/'

    expect(rootedAtExtension(css)).toBe(css)
  })

  it('changes nothing on a second pass', () => {
    const once = rootedAtExtension('.a{background:url(/assets/a.png)}')

    expect(rootedAtExtension(once)).toBe(once)
  })
})

describe('the address each engine fills the extension id into', () => {
  it.each([
    'chrome',
    'edge',
    'chromium',
    'chromium-based'
  ])('is the Chromium one for %s', (browser) => {
    expect(injectedSheetRoot(browser)).toBe(
      'chrome-extension://__MSG_@@extension_id__/'
    )
  })

  it.each([
    'firefox',
    'gecko-based',
    'firefox-based',
    'librewolf'
  ])('is the Firefox one for %s', (browser) => {
    expect(injectedSheetRoot(browser)).toBe(
      'moz-extension://__MSG_@@extension_id__/'
    )
  })

  it('is none for safari, which no measurement covers', () => {
    expect(injectedSheetRoot('safari')).toBeUndefined()
  })

  it('names a Firefox target the three ways a sheet spells a url()', () => {
    const css = [
      '.a { background: url("/assets/a.png"); }',
      ".b { background: url('/assets/b.png?v=1#frag'); }",
      '.c { background: url( /assets/c.png ); }',
      '.d { background: url(//cdn.example.com/d.png); }'
    ].join('\r\n')
    const once = rootedAtExtension(css, GECKO_EXTENSION_ROOT)

    expect(once).toBe(
      [
        `.a { background: url("${GECKO_EXTENSION_ROOT}assets/a.png"); }`,
        `.b { background: url("${GECKO_EXTENSION_ROOT}assets/b.png?v=1#frag"); }`,
        `.c { background: url("${GECKO_EXTENSION_ROOT}assets/c.png"); }`,
        '.d { background: url(//cdn.example.com/d.png); }'
      ].join('\r\n')
    )

    expect(rootedAtExtension(once, GECKO_EXTENSION_ROOT)).toBe(once)
  })
})

describe('the sheets the browser puts on the visited page itself', () => {
  const runtimeEntries = ['scripts/hook', 'scripts/deep/panel']

  it('takes the sheet of a declared content script group', () => {
    expect(isInjectedSheet('content_scripts/content-0.css', [])).toBe(true)
    expect(isInjectedSheet('content_scripts/content-12.css', [])).toBe(true)
  })

  it('takes the sheet kept beside a scripts/ file', () => {
    expect(isInjectedSheet('scripts/hook.css', runtimeEntries)).toBe(true)
    expect(isInjectedSheet('scripts/deep/panel.css', runtimeEntries)).toBe(true)
  })

  it('leaves a page sheet, a script and an unlisted file alone', () => {
    expect(isInjectedSheet('action/index.css', runtimeEntries)).toBe(false)
    expect(isInjectedSheet('content_scripts/content-0.js', [])).toBe(false)
    expect(isInjectedSheet('scripts/other.css', runtimeEntries)).toBe(false)
    expect(isInjectedSheet('scripts/hook.css.map', runtimeEntries)).toBe(false)
  })
})

describe('the targets of a sheet shipped as written and injected by file', () => {
  const from = (css: string) => rootedAtExtensionFrom(css, 'styles/inject.css')

  it('names a relative and a root target from the extension', () => {
    expect(
      from(
        [
          '.a{background:url(img/a.png)}',
          '.b{background:url("./img/b.png?v=1#frag")}',
          ".c{src:url('../fonts/c.woff2')}",
          '.d{background:url(/img/d.png)}',
          '.e{background:url(../../above/e.png)}'
        ].join('\n')
      )
    ).toBe(
      [
        `.a{background:url("${CHROMIUM_EXTENSION_ROOT}styles/img/a.png")}`,
        `.b{background:url("${CHROMIUM_EXTENSION_ROOT}styles/img/b.png?v=1#frag")}`,
        `.c{src:url("${CHROMIUM_EXTENSION_ROOT}fonts/c.woff2")}`,
        `.d{background:url("${CHROMIUM_EXTENSION_ROOT}img/d.png")}`,
        `.e{background:url("${CHROMIUM_EXTENSION_ROOT}above/e.png")}`
      ].join('\n')
    )
  })

  it('leaves a remote, inline, fragment and already named target, and an @import', () => {
    const css = [
      '@import "base.css";',
      '@import url(theme.css);',
      '.a{background:url(//cdn.example.com/a.png)}',
      '.b{background:url(https://example.com/b.png)}',
      '.c{background:url(data:image/png;base64,AAAA)}',
      '.d{background:url(#gradient)}',
      `.e{background:url(${CHROMIUM_EXTENSION_ROOT}img/e.png)}`
    ].join('\n')

    expect(from(css)).toBe(css)
  })

  it('changes nothing on a second pass', () => {
    const once = from('.a{background:url(img/a.png)}')

    expect(from(once)).toBe(once)
  })

  it('keeps the sheets named in one compilation apart from the next', () => {
    const first = {}
    const second = {}

    noteNamedInjectedSheet(first, 'styles/inject.css')

    expect([...namedInjectedSheets(first)]).toEqual(['styles/inject.css'])
    expect([...namedInjectedSheets(second)]).toEqual([])
  })
})

describe('the @import rules a browser honors in a sheet', () => {
  it('reads the target, the layer, the supports test and the media', () => {
    const css = [
      '@charset "utf-8";',
      '/* a comment; with a semicolon */',
      '@layer reset, base;',
      '@import "a.css";',
      "@import url('b.css') print;",
      '@import url(c.css) layer;',
      '@import "d.css" layer(theme.dark) supports(not (display: grid)) screen and (min-width: 10px);',
      '@import url("e;f.css") (prefers-color-scheme: dark);',
      '.own { color: red; }',
      '@import "late.css";'
    ].join('\n')

    expect(
      leadingSheetImports(css).map(({start, end, ...rule}) => ({
        ...rule,
        text: css.slice(start, end)
      }))
    ).toEqual([
      {line: 4, request: 'a.css', text: '@import "a.css";'},
      {
        line: 5,
        request: 'b.css',
        media: 'print',
        text: "@import url('b.css') print;"
      },
      {
        line: 6,
        request: 'c.css',
        layer: true,
        text: '@import url(c.css) layer;'
      },
      {
        line: 7,
        request: 'd.css',
        layer: 'theme.dark',
        supports: 'not (display: grid)',
        media: 'screen and (min-width: 10px)',
        text: '@import "d.css" layer(theme.dark) supports(not (display: grid)) screen and (min-width: 10px);'
      },
      {
        line: 8,
        request: 'e;f.css',
        media: '(prefers-color-scheme: dark)',
        text: '@import url("e;f.css") (prefers-color-scheme: dark);'
      }
    ])
  })

  it('stops at the first rule of another kind, a layer block among them', () => {
    expect(leadingSheetImports('@layer a { .x{} }\n@import "a.css";')).toEqual(
      []
    )

    expect(leadingSheetImports('.x{}\n@import "a.css";')).toEqual([])
    expect(leadingSheetImports('@import "a.css"')).toEqual([])
    expect(leadingSheetImports('@importance "a.css";')).toEqual([])
  })
})

describe('a sheet injected by file with its imports written in', () => {
  const inline = (
    sheets: Record<string, string>,
    name = 'styles/inject.css'
  ) => {
    const skipped: SkippedSheetImport[] = []
    const css = inlinedInjectedSheet(sheets[name], name, {
      read: (asset) => sheets[asset],
      onSkipped: (skip) => skipped.push(skip)
    })

    return {css, skipped}
  }

  it('writes each sheet in place, naming a url() from its own folder', () => {
    const {css, skipped} = inline({
      'styles/inject.css':
        '@import "base.css";\n@import "/root.css";\n.own{background:url(own.png)}',
      'styles/base.css':
        '@import "deep/deep.css";\n.base{background:url(img/base.png)}',
      'styles/deep/deep.css': '.deep{background:url(../up.png)}',
      'root.css': `.root{background:url(${CHROMIUM_EXTENSION_ROOT}named.png)}`
    })

    expect(css).toBe(
      [
        `.deep{background:url("${CHROMIUM_EXTENSION_ROOT}styles/up.png")}`,
        `.base{background:url("${CHROMIUM_EXTENSION_ROOT}styles/img/base.png")}`,
        `.root{background:url(${CHROMIUM_EXTENSION_ROOT}named.png)}`,
        `.own{background:url("${CHROMIUM_EXTENSION_ROOT}styles/own.png")}`
      ].join('\n')
    )

    expect(skipped).toEqual([])
  })

  it('reads an import spelled with the extension address from the root', () => {
    const {css} = inline({
      'styles/inject.css': `@import "${CHROMIUM_EXTENSION_ROOT}shared/a.css";`,
      'shared/a.css': '.a{color:red}'
    })

    expect(css).toBe('.a{color:red}')
  })

  it('keeps the media, the supports test and the layer of an import', () => {
    const {css} = inline({
      'styles/inject.css': [
        '@import "a.css" print;',
        '@import "a.css" layer;',
        '@import "a.css" layer(low) supports(display: grid) screen;',
        ''
      ].join('\n'),
      'styles/a.css': '@charset "utf-8";\n.a{color:red}\n'
    })

    expect(css).toBe(
      [
        '@media print {\n.a{color:red}\n}',
        '@layer {\n.a{color:red}\n}',
        '@supports (display: grid) {\n@media screen {\n@layer low {\n.a{color:red}\n}\n}\n}',
        ''
      ].join('\n')
    )
  })

  it('stops at a sheet that imports one already being written', () => {
    const {css, skipped} = inline({
      'styles/inject.css': '@import "loop.css";.own{color:red}',
      'styles/loop.css':
        '@import "inject.css";@import "loop.css";.loop{color:red}'
    })

    expect(css).toBe('.loop{color:red}.own{color:red}')
    expect(skipped).toEqual([])
  })

  it('keeps and reports an import of another origin or of an absent file', () => {
    const sheet =
      '@import url(https://fonts.example/far.css);\n@import "//cdn.example/x.css";\n@import "gone.css";\n.own{color:red}'
    const {css, skipped} = inline({'styles/inject.css': sheet})

    expect(css).toBe(sheet)
    expect(skipped).toEqual([
      {
        sheet: 'styles/inject.css',
        line: 1,
        request: 'https://fonts.example/far.css',
        reason: 'remote'
      },
      {
        sheet: 'styles/inject.css',
        line: 2,
        request: '//cdn.example/x.css',
        reason: 'remote'
      },
      {
        sheet: 'styles/inject.css',
        line: 3,
        request: 'gone.css',
        reason: 'missing'
      }
    ])
  })

  it('leaves an import a browser skips, the one after another rule', () => {
    const sheet = '.own{color:red}\n@import "late.css";'

    expect(
      inline({'styles/inject.css': sheet, 'styles/late.css': '.l{}'}).css
    ).toBe(sheet)
  })

  it('keeps the public sheets of one compilation apart from the next', () => {
    const first = {}

    notePublicInjectedSheet(first, 'styles/inject.css')

    expect([...publicInjectedSheets(first)]).toEqual(['styles/inject.css'])
    expect([...publicInjectedSheets({})]).toEqual([])
  })
})

describe('the first target of a sheet Chromium reads against the visited page', () => {
  const first = (css: string) => firstPageRelativeTarget(css, 'styles/pub.css')

  it('finds a relative or root target with its line and its full name', () => {
    expect(
      first(
        '@import url(base.css);\n.a{background:url(//cdn.example.com/a.png)}\n.b{background:url("img/b.png?v=2")}\n.c{background:url(/c.png)}'
      )
    ).toEqual({
      request: 'img/b.png?v=2',
      line: 3,
      named: `${CHROMIUM_EXTENSION_ROOT}styles/img/b.png?v=2`
    })

    expect(first('.c{background:url(/c.png)}')).toEqual({
      request: '/c.png',
      line: 1,
      named: `${CHROMIUM_EXTENSION_ROOT}c.png`
    })
  })

  it('finds none in a sheet whose targets read the same from any page', () => {
    expect(
      first(
        `.a{background:url(https://example.com/a.png)}.b{background:url(data:image/png;base64,AAAA)}.c{background:url(#g)}.d{background:url(${CHROMIUM_EXTENSION_ROOT}img/d.png)}`
      )
    ).toBeUndefined()

    expect(first('.a{color:red}')).toBeUndefined()
  })
})
