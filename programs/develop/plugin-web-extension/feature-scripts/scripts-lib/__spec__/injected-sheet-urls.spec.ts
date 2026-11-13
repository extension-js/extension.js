import {describe, expect, it} from 'vitest'
import {
  CHROMIUM_EXTENSION_ROOT,
  GECKO_EXTENSION_ROOT,
  injectedSheetRoot,
  isInjectedSheet,
  rootedAtExtension
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
