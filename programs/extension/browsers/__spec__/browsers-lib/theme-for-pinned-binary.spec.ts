import {describe, expect, it} from 'vitest'
import {withoutThemeForBinary} from '../../browsers-lib/runtime-options'

const THEME = '/cli/dist/extensions/extension-js-theme/chromium'
const DEVTOOLS = '/cli/dist/extensions/extension-js-devtools/chromium'
const USER = '/project/dist/chromium'
const ALL = [DEVTOOLS, THEME, USER]

describe('the built-in theme under a binary pinned by path', () => {
  it.each([
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/opt/microsoft/msedge/msedge',
    '/Applications/Opera.app/Contents/MacOS/Opera',
    '/usr/bin/opera',
    '/Applications/Yandex.app/Contents/MacOS/Yandex',
    '/usr/bin/yandex-browser'
  ])('is left out for %s', (binaryPath) => {
    expect(withoutThemeForBinary(ALL, binaryPath)).toEqual([DEVTOOLS, USER])
  })

  it.each([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    // A folder named after Edge that holds another browser.
    '/home/me/microsoft-edge-tests/chrome',
    '',
    undefined
  ])('stays for %s', (binaryPath) => {
    expect(withoutThemeForBinary(ALL, binaryPath)).toEqual(ALL)
  })

  it('finds the theme under Windows separators too', () => {
    expect(
      withoutThemeForBinary(
        ['C:\\cli\\dist\\extensions\\extension-js-theme\\chromium', USER],
        'C:\\Edge\\msedge.exe'
      )
    ).toEqual([USER])
  })

  it('keeps a user folder that only resembles the theme name', () => {
    const lookalike = '/project/my-extension-js-theme-pack/dist'

    expect(
      withoutThemeForBinary([lookalike], '/usr/bin/microsoft-edge')
    ).toEqual([lookalike])
  })
})
