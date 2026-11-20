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
