import {describe, expect, it} from 'vitest'
import {
  extractUrlAttributeLiterals,
  findMovedPageRelativeUrls
} from '../steps/warn-moved-page-relative-urls'

describe('src and href literals a script sets', () => {
  it('reads a props object, the shape JSX compiles to', () => {
    expect(
      extractUrlAttributeLiterals(
        '(0,r.jsx)("img",{src:"icon128.png",alt:""}),h("a",{"href":\'docs/help.html\'})'
      )
    ).toEqual(['icon128.png', 'docs/help.html'])
  })

  it('reads an assignment, setAttribute and a JSX attribute', () => {
    expect(
      extractUrlAttributeLiterals(
        [
          'img.src = "a.png"',
          'link.setAttribute("href", "b.css")',
          'const el = <img src="c.png" />',
          'const other = <img src={"d.png"} />'
        ].join('\n')
      )
    ).toEqual(['a.png', 'c.png', 'd.png', 'b.css'])
  })

  it('leaves a comparison, a computed value and a comment alone', () => {
    expect(
      extractUrlAttributeLiterals(
        [
          'if (img.src == "a.png") {}',
          'if (img.src === "a.png") {}',
          'img.src = base + "a.png"',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, the placeholder is literal
          'img.src = `${base}a.png`',
          '// img.src = "b.png"'
        ].join('\n')
      )
    ).toEqual([])
  })
})

describe('findMovedPageRelativeUrls', () => {
  const shipped = new Set([
    'sidebar/index.html',
    'sidebar/index.js',
    'sidebar/beside.png',
    'logo.png',
    'img/deep.svg',
    'beside.png'
  ])
  const find = (text: string, source = 'index.html') =>
    findMovedPageRelativeUrls(
      [
        {
          source,
          output: 'sidebar/index.html',
          scripts: [{assetName: 'sidebar/index.js', text}]
        }
      ],
      (distRel) => shipped.has(distRel)
    )

  it('names a file the output holds where the page was written, not beside it', () => {
    expect(
      find('h("img",{src:"logo.png"}),h("img",{src:"./img/deep.svg"})')
    ).toEqual([
      {
        page: 'sidebar/index.html',
        assetName: 'sidebar/index.js',
        literal: 'logo.png',
        requested: 'sidebar/logo.png',
        emitted: 'logo.png'
      },
      {
        page: 'sidebar/index.html',
        assetName: 'sidebar/index.js',
        literal: './img/deep.svg',
        requested: 'sidebar/img/deep.svg',
        emitted: 'img/deep.svg'
      }
    ])
  })

  it('reports a literal once per page', () => {
    expect(find('a({src:"logo.png"});b({src:"logo.png"})')).toHaveLength(1)
  })

  it('leaves alone a rooted path, a url, a file beside the page and one the output lacks', () => {
    expect(
      find(
        [
          'a({src:"/logo.png"})',
          'a({src:"https://example.com/logo.png"})',
          'a({src:"data:image/png;base64,AAAA"})',
          'a({src:"beside.png"})',
          'a({src:"missing.png"})',
          'a({href:"#top"})',
          'a({href:"logo"})'
        ].join(';')
      )
    ).toEqual([])
  })

  it('leaves alone a page the build ships in the folder it was written in', () => {
    expect(find('a({src:"logo.png"})', 'sidebar/index.html')).toEqual([])
  })

  it('resolves against the folder the page was written in', () => {
    // Written in panel/, where logo.png never resolved to the root file.
    expect(find('a({src:"logo.png"})', 'panel/index.html')).toEqual([])
    // One folder deep before and after, so the climb still lands on it.
    expect(find('a({src:"../logo.png"})', 'panel/index.html')).toEqual([])
    expect(find('a({src:"../beside.png"})', 'a/b/index.html')).toEqual([])
  })
})
