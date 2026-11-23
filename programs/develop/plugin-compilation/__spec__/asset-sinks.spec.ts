import * as parse5utilities from 'parse5-utilities'
import postcss from 'postcss'
import {describe, expect, it} from 'vitest'
import {escapeForHtmlAsset} from '../compilation-lib/asset-sinks'

// Values picked to close a quote, a tag, a comment or a line in each sink.
const HOSTILE = [
  'plain',
  '',
  'A "great" C:\\path <b> & it\'s',
  'x"</style><script>window.pwned=1</script>',
  "y'</script><!-- <script>",
  'line1\nline2\r\nline3',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, the placeholder is literal
  '`${boom}` $& $1 $',
  '*/ ); } // -- --> --!>',
  'https://example.com/a b?c=(d)&e=`f`',
  'trailing\\'
]

interface Node {
  nodeName: string
  value?: string
  data?: string
  attrs?: Array<{name: string; value: string}>
  childNodes?: Node[]
  content?: Node
}

// Fills every placeholder the way the env stage does, from the authored text.
function fill(html: string, value: string): string {
  return html.replace(/\$EXTENSION_[A-Z0-9_]+/g, (_match, offset: number) =>
    escapeForHtmlAsset(html, offset, value)
  )
}

function walk(node: Node, visit: (node: Node) => void) {
  visit(node)
  for (const child of node.childNodes || []) walk(child, visit)
}

function parse(html: string) {
  const document = parse5utilities.parse(html) as unknown as Node

  const byId = (id: string) => {
    let found: Node | undefined

    walk(document, (node) => {
      if (node.attrs?.some((a) => a.name === 'id' && a.value === id)) {
        found = node
      }
    })

    return found
  }

  const attribute = (id: string, name: string) =>
    byId(id)?.attrs?.find((a) => a.name === name)?.value
  const text = (id: string) =>
    (byId(id)?.childNodes || []).map((child) => child.value ?? '').join('')

  const count = (nodeName: string) => {
    let total = 0

    walk(document, (node) => {
      if (node.nodeName === nodeName) total++
    })

    return total
  }

  return {byId, attribute, text, count}
}

// What the page would run: the text of the one inline script, as parsed.
function runInlineScript(html: string, scope: Record<string, unknown> = {}) {
  const page = parse(html)

  expect(page.count('script')).toBe(1)
  expect(page.byId('after')).toBeDefined()
  new Function('out', page.text('code'))(scope)

  return scope
}

const unescapeCss = (text: string) =>
  text.replace(/\\(?:([0-9a-fA-F]{1,6}) ?|([\s\S]))/g, (_m, hex, char) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : char
  )

function declarations(css: string): Record<string, string> {
  const found: Record<string, string> = {}

  postcss.parse(css).walkDecls((decl) => {
    found[`${(decl.parent as {selector?: string}).selector} ${decl.prop}`] =
      decl.value
  })

  return found
}

describe('markup sinks', () => {
  it.each(HOSTILE)('keeps %j whole in text, attributes and raw text', (v) => {
    const page = parse(
      fill(
        [
          '<title id="title">$EXTENSION_PUBLIC_V</title>',
          '<p id="text">$EXTENSION_PUBLIC_V</p>',
          '<p id="double" title="$EXTENSION_PUBLIC_V" class="k"></p>',
          "<p id='single' title='$EXTENSION_PUBLIC_V' class='k'></p>",
          '<p id=bare title=$EXTENSION_PUBLIC_V class=k></p>',
          '<p id=mixed title=a$EXTENSION_PUBLIC_V class=k></p>',
          '<textarea id="area">.$EXTENSION_PUBLIC_V</textarea>',
          '<p id="after"></p>'
        ].join(''),
        v
      )
    )
    expect(page.text('title')).toBe(v)
    expect(page.text('text')).toBe(v)
    expect(page.text('area')).toBe(`.${v}`)

    for (const id of ['double', 'single', 'bare']) {
      expect([id, page.attribute(id, 'title')]).toEqual([id, v])
      expect([id, page.attribute(id, 'class')]).toEqual([id, 'k'])
    }

    expect(page.attribute('mixed', 'title')).toBe(`a${v}`)
    expect(page.attribute('mixed', 'class')).toBe('k')
    expect(page.byId('after')).toBeDefined()
    expect(page.count('script')).toBe(0)
  })

  it.each(HOSTILE)('keeps %j inside the comment it was written in', (v) => {
    const page = parse(
      fill(
        '<p id="before"></p><!--$EXTENSION_PUBLIC_V--><!-- a $EXTENSION_PUBLIC_V b --><p id="after"></p>',
        v
      )
    )

    expect(page.count('#comment')).toBe(2)
    expect(page.count('script')).toBe(0)
    expect(page.byId('after')).toBeDefined()
  })

  it('reads an attribute value that holds a > as one value', () => {
    const html = '<p id="t" data-a="1 > 0" title="$EXTENSION_PUBLIC_V"></p>'

    expect(parse(fill(html, 'a"b')).attribute('t', 'title')).toBe('a"b')
  })

  it('escapes for the language inside an event handler and a style attribute', () => {
    for (const v of HOSTILE) {
      const page = parse(
        fill(
          [
            '<button id="handler" onclick="out.v=\'$EXTENSION_PUBLIC_V\'"></button>',
            '<p id="styled" style="background:url(\'$EXTENSION_PUBLIC_V\')"></p>',
            '<p id="after"></p>'
          ].join(''),
          v
        )
      )
      const scope: {v?: string} = {}
      new Function('out', page.attribute('handler', 'onclick') || '')(scope)

      expect(scope.v).toBe(v)

      const value = declarations(`a{${page.attribute('styled', 'style')}}`)[
        'a background'
      ]
      expect(unescapeCss(value.slice("url('".length, -"')".length))).toBe(v)
    }
  })
})

describe('inline script sinks', () => {
  const script = (code: string, attributes = '') =>
    `<script id="code"${attributes}>${code}</script><p id="after"></p>`

  it.each(
    HOSTILE
  )('keeps %j whole in a single, double and template quote', (v) => {
    const scope = runInlineScript(
      fill(
        script(
          [
            'out.double = "$EXTENSION_PUBLIC_V";',
            "out.single = '$EXTENSION_PUBLIC_V';",
            'out.template = `$EXTENSION_PUBLIC_V`;',
            // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, the placeholder is literal
            'out.joined = `a${1}$EXTENSION_PUBLIC_V{b}`;'
          ].join('\n')
        ),
        v
      )
    )

    expect(scope).toEqual({
      double: v,
      single: v,
      template: v,
      joined: `a1${v}{b}`
    })
  })

  it.each(
    HOSTILE
  )('is not turned around by a regex literal or a division before %j', (v) => {
    const scope = runInlineScript(
      fill(
        script(
          [
            'var re = /"/; out.double = "$EXTENSION_PUBLIC_V";',
            "var re2 = /'/; out.single = '$EXTENSION_PUBLIC_V';",
            'var half = 4 / 2; out.after = "$EXTENSION_PUBLIC_V"; var q = 4 / 2;',
            'var re3 = /[`/]/; out.template = `$EXTENSION_PUBLIC_V`;'
          ].join('\n')
        ),
        v
      )
    )

    expect(scope).toEqual({double: v, single: v, after: v, template: v})
  })

  it.each(HOSTILE)('matches %j as literal text inside a regex literal', (v) => {
    const scope = runInlineScript(
      fill(script('out.matched = /^$EXTENSION_PUBLIC_V$/.test(out.value);'), v),
      {value: v}
    )

    expect(scope.matched).toBe(true)
  })

  it.each(HOSTILE)('keeps %j inside the comment it was written in', (v) => {
    const scope = runInlineScript(
      fill(
        script(
          [
            'out.v = 1 // note $EXTENSION_PUBLIC_V',
            '/* note $EXTENSION_PUBLIC_V */',
            'out.w = 2'
          ].join('\n')
        ),
        v
      )
    )

    expect(scope).toEqual({v: 1, w: 2})
  })

  it('cannot leave a comment through a line break or a comment end', () => {
    const html = script(
      '// $EXTENSION_PUBLIC_V\n/* $EXTENSION_PUBLIC_V */ out.v = 1'
    )

    expect(runInlineScript(fill(html, 'x\nout.v = 2 /* */ out.v = 3'))).toEqual(
      {v: 1}
    )
  })

  it('takes a placeholder that stands as code as written, and keeps the tag open', () => {
    const html = script('out.v = $EXTENSION_PUBLIC_V;')

    expect(runInlineScript(fill(html, '42')).v).toBe(42)
    expect(
      runInlineScript(fill(html, '{"a":[1,"</script><!--"],"b":"it\'s"}')).v
    ).toEqual({a: [1, '</script><!--'], b: "it's"})
  })

  it.each(
    HOSTILE
  )('uses the body that is inert in every quote when the script does not parse, for %j', (v) => {
    // A return at the top level is no program, yet it runs as a function body.
    const scope = runInlineScript(
      fill(
        script(
          [
            'out.double = "$EXTENSION_PUBLIC_V";',
            "out.single = '$EXTENSION_PUBLIC_V';",
            'out.template = `$EXTENSION_PUBLIC_V`;',
            '/* $EXTENSION_PUBLIC_V */',
            'return;'
          ].join('\n')
        ),
        v
      )
    )

    expect(scope).toEqual({double: v, single: v, template: v})
  })

  it('reads a module script as a module', () => {
    const html = script(
      'var re = /"/; out.v = "$EXTENSION_PUBLIC_V"; out.url = import.meta.url;',
      ' type="module"'
    )

    expect(parse(fill(html, 'a"b\nc')).text('code')).toContain(
      'out.v = "a\\"b\\nc";'
    )
  })

  it.each(HOSTILE)('keeps %j whole in a JSON script', (v) => {
    for (const type of [
      'application/json',
      'application/ld+json',
      'importmap'
    ]) {
      const page = parse(
        fill(
          script(
            '{"quoted":"$EXTENSION_PUBLIC_V","list":["$EXTENSION_PUBLIC_V"]}',
            ` type="${type}"`
          ),
          v
        )
      )

      expect(page.byId('after')).toBeDefined()
      expect(JSON.parse(page.text('code'))).toEqual({quoted: v, list: [v]})
    }
  })

  it('takes a bare JSON value as written and keeps the tag open', () => {
    const page = parse(
      fill(
        script('{"bare":$EXTENSION_PUBLIC_V}', ' type="application/json"'),
        '{"a":"</script><!--"}'
      )
    )

    expect(page.byId('after')).toBeDefined()
    expect(JSON.parse(page.text('code'))).toEqual({
      bare: {a: '</script><!--'}
    })
  })

  it.each(HOSTILE)('keeps %j inside a data block of another type', (v) => {
    const page = parse(
      fill(script('<b>$EXTENSION_PUBLIC_V</b>', ' type="text/x-template"'), v)
    )

    expect(page.count('script')).toBe(1)
    expect(page.byId('after')).toBeDefined()
    expect(page.text('code')).not.toMatch(/<\/script|<!--/i)
  })
})

describe('style sinks', () => {
  it.each(HOSTILE)('keeps %j whole in a string and in a url', (v) => {
    const page = parse(
      fill(
        [
          '<style id="sheet">',
          '/* it\'s a "note" */',
          '.double::before{content:"$EXTENSION_PUBLIC_V"}',
          ".single::before{content:'$EXTENSION_PUBLIC_V'}",
          '.bare{background:url($EXTENSION_PUBLIC_V)}',
          '.quoted{background:url("$EXTENSION_PUBLIC_V")}',
          '/* $EXTENSION_PUBLIC_V */',
          '.last{color:red}',
          '</style><p id="after"></p>'
        ].join('\n'),
        v
      )
    )
    const found = declarations(page.text('sheet'))

    expect(page.byId('after')).toBeDefined()
    expect(page.count('script')).toBe(0)
    expect(unescapeCss(found['.double::before content'].slice(1, -1))).toBe(v)
    expect(unescapeCss(found['.single::before content'].slice(1, -1))).toBe(v)
    expect(unescapeCss(found['.bare background'].slice(4, -1))).toBe(v)
    expect(unescapeCss(found['.quoted background'].slice(5, -2))).toBe(v)
    expect(found['.last color']).toBe('red')
  })

  it('takes a placeholder that stands as CSS as written, and keeps the tag open', () => {
    const html =
      '<style id="sheet">.a{color:$EXTENSION_PUBLIC_V}</style><p id="after"></p>'

    expect(declarations(parse(fill(html, '#0af')).text('sheet'))).toEqual({
      '.a color': '#0af'
    })

    const page = parse(fill(html, 'red}</style><script>window.pwned=1'))
    expect(page.count('script')).toBe(0)
    expect(page.byId('after')).toBeDefined()
  })
})

// A terminator the value does not hold whole, finished by the authored text
// on one side of the placeholder.
describe('a value that joins the authored text beside it', () => {
  const after = '<p id="after"></p>'
  const script = (code: string, attributes = '') =>
    `<script id="code"${attributes}>${code}</script>${after}`
  const sheet = (css: string) => `<style id="sheet">${css}</style>${after}`

  it('cannot turn an authored < into a tag or an element end in text', () => {
    const opened = parse(
      fill(`<p id="t"><$EXTENSION_PUBLIC_V src=x></p>${after}`, 'script')
    )

    expect(opened.count('script')).toBe(0)
    expect(opened.text('t')).toBe('<script src=x>')

    const closed = parse(
      fill(`<div id="t"><$EXTENSION_PUBLIC_V>x</div>${after}`, '/div')
    )

    expect(closed.text('t')).toBe('</div>x')
  })

  it('cannot finish an authored character reference', () => {
    const named = parse(fill('<p id="t">&$EXTENSION_PUBLIC_V</p>', 'lt;b'))
    const numbered = parse(fill('<p id="t">&#$EXTENSION_PUBLIC_V</p>', '60;'))

    expect(named.text('t')).toBe('&lt;b')
    expect(numbered.text('t')).toBe('&#60;')
  })

  it.each([
    ['<title id="t"></tit$EXTENSION_PUBLIC_V> x</title>', 'le'],
    ['<title id="t"><$EXTENSION_PUBLIC_V> x</title>', '/title'],
    ['<textarea id="t"></$EXTENSION_PUBLIC_V> x</textarea>', 'textarea']
  ])('cannot end a raw text element in %s', (html, value) => {
    const page = parse(fill(html + after, value))

    expect(page.text('t')).toMatch(/^<\/t(?:itle|extarea)> x$/)
    expect(page.byId('after')).toBeDefined()
  })

  it.each([
    ['<!-- a --$EXTENSION_PUBLIC_V> <p id="inside"></p> -->', '!'],
    ['<!-- a -$EXTENSION_PUBLIC_V> <p id="inside"></p> -->', '-'],
    ['<!-- a $EXTENSION_PUBLIC_V-> <p id="inside"></p> -->', '-'],
    ['<!-- a $EXTENSION_PUBLIC_V> <p id="inside"></p> -->', '--!'],
    ['<!--$EXTENSION_PUBLIC_V> <p id="inside"></p> -->', '-']
  ])('cannot end the HTML comment in %s with %j', (html, value) => {
    const page = parse(fill(html + after, value))

    expect(page.count('#comment')).toBe(1)
    expect(page.byId('inside')).toBeUndefined()
    expect(page.byId('after')).toBeDefined()
  })

  it.each([
    ['out.v = "<$EXTENSION_PUBLIC_V>";', '/script', '</script>'],
    ["out.v = '<$EXTENSION_PUBLIC_V>';", '/script', '</script>'],
    ['out.v = `<$EXTENSION_PUBLIC_V>`;', '/script', '</script>'],
    ['out.v = "</scr$EXTENSION_PUBLIC_V>";', 'ipt', '</script>'],
    ['out.v = "</scr$EXTENSION_PUBLIC_Vipt>";', '', '</script>'],
    ['out.v = "<$EXTENSION_PUBLIC_V";', '!--', '<!--'],
    ['out.v = "<$EXTENSION_PUBLIC_V>"; return;', '/script', '</script>'],
    ['out.v = "</scr$EXTENSION_PUBLIC_V>"; return;', 'ipt', '</script>']
  ])('cannot end the script from inside a quote in %s', (code, value, v) => {
    expect(runInlineScript(fill(script(code), value))).toEqual({v})
  })

  it.each([
    ['out.v = "a\\$EXTENSION_PUBLIC_V"; out.w = 1;'],
    ["out.v = 'a\\$EXTENSION_PUBLIC_V'; out.w = 1;"],
    ['out.v = `a\\$EXTENSION_PUBLIC_V`; out.w = 1;']
  ])('is not swallowed by an authored backslash in %s', (code) => {
    for (const value of ['', '"', "'", '`', 'n', '\\']) {
      expect([value, runInlineScript(fill(script(code), value))]).toEqual([
        value,
        {v: `a${value}`, w: 1}
      ])
    }
  })

  it.each([
    ['/* $EXTENSION_PUBLIC_V/ out.v = 2; /* x */ out.w = 1;', '*'],
    ['/* *$EXTENSION_PUBLIC_V out.v = 2; /* x */ out.w = 1;', '/'],
    ['/* $EXTENSION_PUBLIC_V out.v = 2; /* x */ out.w = 1;', '*\\/ *//'],
    ['// <$EXTENSION_PUBLIC_V>\nout.w = 1;', '/script'],
    ['/* <$EXTENSION_PUBLIC_V> */ out.w = 1;', '/script'],
    ['/* $EXTENSION_PUBLIC_V/ out.v = 2; /* x */ out.w = 1; return;', '*'],
    ['/* *$EXTENSION_PUBLIC_V out.v = 2; /* x */ out.w = 1; return;', '/']
  ])('cannot end the script comment in %s with %j', (code, value) => {
    expect(runInlineScript(fill(script(code), value))).toEqual({w: 1})
  })

  it('cannot end the script from a placeholder that stands as code', () => {
    const page = parse(
      fill(script('out.v = 1 <$EXTENSION_PUBLIC_V> 2;'), '/script')
    )

    expect(page.count('script')).toBe(1)
    expect(page.byId('after')).toBeDefined()
    expect(page.text('code')).toMatch(/> 2;$/)
  })

  it('cannot end the script from inside a regex class', () => {
    const scope = runInlineScript(
      fill(script('out.v = /[</scr$EXTENSION_PUBLIC_V>]/.test("i");'), 'ipt')
    )

    expect(scope).toEqual({v: true})
  })

  it('does not leave a regex open after an authored backslash', () => {
    for (const value of ['', '/', 'd']) {
      const scope = runInlineScript(
        fill(script('var re = /a\\$EXTENSION_PUBLIC_V/; out.w = 1;'), value)
      )

      expect([value, scope]).toEqual([value, {w: 1}])
    }
  })

  // An authored backslash outside a quote has to escape a character, so it
  // escapes the first one of the value and the value reads as it was given.
  const AFTER_BACKSLASH = ['d', '/', '.', 'n', '\\', '</script>', '\u{1f600}x']

  it.each(
    AFTER_BACKSLASH
  )('reads %j as given after an authored backslash in a regex', (value) => {
    const code =
      'out.v = /^a\\$EXTENSION_PUBLIC_V$/.test(out.text); ' +
      'out.u = /^a\\$EXTENSION_PUBLIC_V$/u.test(out.text);'
    const scope = runInlineScript(fill(script(code), value), {
      text: `a${value}`
    })

    expect(scope).toEqual({text: `a${value}`, v: true, u: true})
  })

  it.each(
    AFTER_BACKSLASH
  )('reads %j as given after an authored backslash in a handler', (value) => {
    for (const quote of ["'", '`']) {
      const page = parse(
        fill(
          `<button id="handler" onclick="out.v=${quote}a\\$EXTENSION_PUBLIC_V${quote}"></button>`,
          value
        )
      )
      const scope: Record<string, unknown> = {}

      new Function('out', page.attribute('handler', 'onclick') || '')(scope)

      expect([quote, scope]).toEqual([quote, {v: `a${value}`}])
    }
  })

  // No character follows, so the backslash can only stand for itself. The
  // statement after it still runs, which is what the value must not change.
  it('reads an empty value after an authored backslash as the backslash', () => {
    const scope = runInlineScript(
      fill(
        script('out.v = /^a\\$EXTENSION_PUBLIC_V$/.test(out.text); out.w = 1;'),
        ''
      ),
      {text: 'a\\'}
    )

    expect(scope).toEqual({text: 'a\\', v: true, w: 1})
  })

  // The value adds no character here, so the page reads as it was authored.
  it.each([
    ['out.v = /<\\/scr$EXTENSION_PUBLIC_Vipt/.test("</script");'],
    ['out.v = /<\\/scr$EXTENSION_PUBLIC_Vipt/.test("</script"); return;']
  ])('adds nothing to %s with an empty value', (code) => {
    const html = script(code)

    expect(fill(html, '')).toBe(html.replace('$EXTENSION_PUBLIC_V', ''))
  })

  it('adds nothing to markup text with an empty value', () => {
    const html = '<p id="text">a <$EXTENSION_PUBLIC_Vb>bold</b></p>'

    expect(fill(html, '')).toBe(html.replace('$EXTENSION_PUBLIC_V', ''))
    expect(parse(fill(html, 'x')).text('text')).toBe('a <xb>bold')
  })

  it('cannot end a JSON script or a data block', () => {
    const json = parse(
      fill(
        script('{"v":"<$EXTENSION_PUBLIC_V>"}', ' type="application/json"'),
        '/script'
      )
    )

    expect(json.byId('after')).toBeDefined()
    expect(JSON.parse(json.text('code'))).toEqual({v: '</script>'})

    const data = parse(
      fill(
        script(
          '<$EXTENSION_PUBLIC_V> <p id="inside"></p>',
          ' type="text/x-template"'
        ),
        '/script'
      )
    )

    expect(data.byId('inside')).toBeUndefined()
    expect(data.count('script')).toBe(1)
  })

  it.each([
    ['/* $EXTENSION_PUBLIC_V/ .x{color:blue} /* x */ .a{color:red}', '*'],
    ['/* *$EXTENSION_PUBLIC_V .x{color:blue} /* x */ .a{color:red}', '/'],
    ['/* $EXTENSION_PUBLIC_V .x{color:blue} /* x */ .a{color:red}', '*\\/ *//']
  ])('cannot end the CSS comment in %s with %j', (css, value) => {
    expect(declarations(parse(fill(sheet(css), value)).text('sheet'))).toEqual({
      '.a color': 'red'
    })
  })

  it('cannot end the style sheet from a string, a url or a declaration', () => {
    const page = parse(
      fill(
        sheet(
          [
            '.s::before{content:"<$EXTENSION_PUBLIC_V>"}',
            '.u{background:url(<$EXTENSION_PUBLIC_V)}',
            '.c{color:<$EXTENSION_PUBLIC_V>}',
            '/* <$EXTENSION_PUBLIC_V> */',
            '.last{color:red}'
          ].join('\n')
        ),
        '/style'
      )
    )
    const css = page.text('sheet')

    expect(page.byId('after')).toBeDefined()
    expect(css).toMatch(/\.last\{color:red\}$/)
    expect(
      unescapeCss(declarations(css)['.s::before content'].slice(1, -1))
    ).toBe('</style>')
  })

  it.each([
    ['.s::before{content:"a\\$EXTENSION_PUBLIC_V"}\n.b{color:red}'],
    [".s::before{content:'a\\$EXTENSION_PUBLIC_V'}\n.b{color:red}"],
    ['.u{background:url(a\\$EXTENSION_PUBLIC_V)}\n.b{color:red}']
  ])('is not swallowed by an authored backslash in %s', (css) => {
    for (const value of ['', '"', "'", ')', 'a']) {
      const found = declarations(parse(fill(sheet(css), value)).text('sheet'))

      expect([value, found['.b color']]).toEqual([value, 'red'])
    }
  })

  it.each([
    'a',
    ')',
    ' ',
    '\\',
    '"',
    '\u{1f600}x'
  ])('reads %j as given after an authored backslash in url()', (value) => {
    const found = declarations(
      parse(
        fill(sheet('.u{background:url(a\\$EXTENSION_PUBLIC_V)}'), value)
      ).text('sheet')
    )

    expect(unescapeCss(found['.u background'].slice(4, -1))).toBe(`a${value}`)
  })
})
