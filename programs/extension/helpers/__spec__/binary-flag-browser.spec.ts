import {describe, expect, it} from 'vitest'
import {browserForBinaryFlags} from '../binary-flag-browser'

const FOX = '/opt/fox/firefox'
const CHROME = '/opt/chrome/chrome'

describe('a binary flag with no --browser picks its own engine', () => {
  it.each([
    ['--gecko-binary alone', {geckoBinary: FOX}, 'gecko-based'],
    [
      '--chromium-binary alone, on the stock name',
      {chromiumBinary: CHROME},
      undefined
    ],
    [
      '--gecko-binary over a Chromium browser in the config',
      {geckoBinary: FOX, configBrowser: 'chrome'},
      'gecko-based'
    ],
    [
      '--chromium-binary over a Gecko browser in the config',
      {chromiumBinary: CHROME, configBrowser: 'firefox'},
      'chromium-based'
    ],
    [
      '--gecko-binary beside a Gecko browser in the config',
      {geckoBinary: FOX, configBrowser: 'zen'},
      'zen'
    ],
    [
      '--chromium-binary beside a Chromium browser in the config',
      {chromiumBinary: CHROME, configBrowser: 'edge'},
      'edge'
    ],
    ['no binary flag', {configBrowser: 'firefox'}, 'firefox'],
    ['nothing at all', {}, undefined]
  ])('%s', (_name, input, browser) => {
    expect(browserForBinaryFlags(input)).toEqual({browser})
  })
})

describe('a binary flag beside a typed --browser', () => {
  it.each([
    ['firefox', {geckoBinary: FOX}],
    ['gecko-based', {geckoBinary: FOX}],
    ['chrome', {chromiumBinary: CHROME}],
    ['chromium-emulator', {chromiumBinary: CHROME}],
    ['chrome,firefox', {chromiumBinary: CHROME, geckoBinary: FOX}],
    ['all', {chromiumBinary: CHROME, geckoBinary: FOX}]
  ])('keeps --browser %s, which runs the engine the flag pins', (typedBrowser, flags) => {
    expect(browserForBinaryFlags({typedBrowser, ...flags})).toEqual({
      browser: typedBrowser,
      refusal: undefined
    })
  })

  it.each([
    [
      'chromium',
      {geckoBinary: FOX},
      '--gecko-binary pins a Gecko binary, and --browser chromium runs no Gecko browser. Drop --browser to run the binary, or pass --browser gecko-based.'
    ],
    [
      'firefox',
      {chromiumBinary: CHROME},
      '--chromium-binary pins a Chromium binary, and --browser firefox runs no Chromium browser. Drop --browser to run the binary, or pass --browser chromium-based.'
    ],
    [
      'chrome,edge',
      {chromiumBinary: CHROME, geckoBinary: FOX},
      '--gecko-binary pins a Gecko binary, and --browser chrome,edge runs no Gecko browser. Drop --browser to run the binary, or pass --browser gecko-based.'
    ],
    [
      'safari',
      {geckoBinary: FOX},
      '--gecko-binary pins a Gecko binary, and --browser safari runs no Gecko browser. Drop --browser to run the binary, or pass --browser gecko-based.'
    ]
  ])('refuses --browser %s, naming both flags', (typedBrowser, flags, refusal) => {
    expect(browserForBinaryFlags({typedBrowser, ...flags}).refusal).toBe(
      refusal
    )
  })

  it('never reads the config browser once --browser is typed', () => {
    expect(
      browserForBinaryFlags({
        typedBrowser: 'chromium',
        configBrowser: 'firefox',
        geckoBinary: FOX
      }).refusal
    ).toMatch(/--browser chromium runs no Gecko browser/)
  })
})

describe('both binary flags with no --browser', () => {
  const both = {chromiumBinary: CHROME, geckoBinary: FOX}

  it('is refused, since nothing says which to run', () => {
    expect(browserForBinaryFlags(both).refusal).toBe(
      '--chromium-binary and --gecko-binary each pin a browser, and no --browser says which to run. Pass one of them, or name both with --browser chromium-based,gecko-based.'
    )
  })

  it('runs a config list that holds both engines', () => {
    expect(
      browserForBinaryFlags({...both, configBrowser: 'chrome,firefox'})
    ).toEqual({browser: 'chrome,firefox'})
  })
})
