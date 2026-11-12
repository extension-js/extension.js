import assert from 'node:assert/strict'
import test from 'node:test'
import {
  debugPortFromArgv,
  isOwnOrBlankPage,
  isOwnPage,
  ownExtensionIds
} from '../lib/browser-identity-pages.mjs'
import {judgeIdentityRun} from '../lib/browser-identity-verdict.mjs'
import {
  argvIsHeadless,
  judgeNativeWindows,
  loadExtensionPaths,
  nativeWindowSkipReason,
  themeCompanionPaths
} from '../lib/native-windows.mjs'

const skip = (target) => ({
  target,
  cacheLabel: 'warm',
  status: 'SKIP',
  detail: `${target} isn't installed.`
})
const pass = (target) => ({
  target,
  cacheLabel: 'warm',
  status: 'PASS',
  detail: ''
})

test('a run where every target skipped fails unless skips were allowed', () => {
  const rows = [skip('brave'), skip('vivaldi'), skip('zen')]
  const verdict = judgeIdentityRun(rows)

  assert.equal(verdict.ok, false)
  assert.match(verdict.message, /0 of 3 target\(s\)/)
  assert.match(verdict.message, /skipped: brave, vivaldi, zen/)
  assert.match(verdict.message, /--allow-skips/)
})

test('an empty run proved nothing and fails', () => {
  assert.equal(judgeIdentityRun([]).ok, false)
})

test('--allow-skips accepts an all-skip run and still says how many targets were proved', () => {
  const verdict = judgeIdentityRun([skip('brave'), skip('zen')], {
    allowSkips: true
  })

  assert.equal(verdict.ok, true)
  assert.match(verdict.message, /^PASS: 0 of 2 target\(s\)/)
  assert.match(verdict.message, /2 skipped \(brave, zen\)/)
})

test('a partial run names how many targets it actually proved', () => {
  const verdict = judgeIdentityRun([pass('chrome'), skip('brave'), skip('zen')])

  assert.equal(verdict.ok, true)
  assert.match(verdict.message, /^PASS: 1 of 3 target\(s\)/)
  assert.match(verdict.message, /2 skipped \(brave, zen\)/)
})

test('a full pass reports every target without a skip note', () => {
  const verdict = judgeIdentityRun([pass('chrome'), pass('firefox')])

  assert.equal(verdict.ok, true)
  assert.equal(
    verdict.message,
    'PASS: 2 of 2 target(s) ran the browser the card names'
  )
})

test('a failed target fails the run whatever the skip policy', () => {
  const rows = [
    pass('chrome'),
    {
      target: 'brave',
      cacheLabel: 'warm',
      status: 'FAIL',
      detail: 'ran a managed Chrome'
    }
  ]

  for (const allowSkips of [false, true]) {
    const verdict = judgeIdentityRun(rows, {allowSkips})

    assert.equal(verdict.ok, false)
    assert.match(
      verdict.message,
      /1 target\(s\) did not run the browser they claim/
    )

    assert.match(verdict.message, /brave \(ran a managed Chrome\)/)
  }
})

const COMPANION = 'kgdaecdpfkikjncaalnmmnjjfpofkcbl'
const GUEST = 'ecbmcgibpkjadedbljkbhenlcobgphle'
const ownIds = ownExtensionIds({
  extensionId: GUEST,
  managedExtensions: [{id: COMPANION}, {path: '/no/id'}]
})

test("Vivaldi's setup wizard is the browser's own page under every address it has had", () => {
  for (const url of [
    'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/components/welcome/welcome.html',
    'vivaldi://welcome/',
    'vivaldi:welcome',
    'chrome://welcome/',
    'chrome://vivaldi-webui/welcome'
  ]) {
    assert.equal(isOwnOrBlankPage(url, ownIds), false, url)
    assert.equal(isOwnPage(url, ownIds), false, url)
  }
})

test("Vivaldi 8.3's start page left in front of the reader is not a blank surface", () => {
  assert.equal(
    isOwnOrBlankPage('chrome://vivaldi-webui/startpage', ownIds),
    false
  )
})

test('our own pages and the engine blank surfaces stay accepted', () => {
  for (const url of [
    `chrome-extension://${COMPANION}/pages/welcome.html`,
    `chrome-extension://${GUEST}/popup.html`,
    'chrome://extensions/',
    'chrome://startpage/',
    'chrome://newtab/',
    'about:blank',
    ''
  ]) {
    assert.equal(isOwnOrBlankPage(url, ownIds), true, url)
  }

  assert.equal(
    isOwnPage(`chrome-extension://${COMPANION}/pages/welcome.html`, ownIds),
    true
  )

  assert.equal(isOwnPage('chrome://extensions/', ownIds), false)
})

test('a contract with no cdpPort still finds the port in the browser argv', () => {
  assert.equal(
    debugPortFromArgv(
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi --remote-debugging-port=9642 --remote-debugging-address=127.0.0.1'
    ),
    9642
  )

  assert.equal(debugPortFromArgv('/bin/vivaldi --remote-debugging-pipe'), null)
  assert.equal(debugPortFromArgv('/bin/opera --remote-debugging-port=0'), null)
  assert.equal(debugPortFromArgv(null), null)
})

const win = (name, onscreen, width, height) => ({name, onscreen, width, height})
const strip = win('', false, 1512, 33)

test('the forced Opera load-error dialog fails: one untitled window, no titled one', () => {
  // Both readings were measured: the alert reads on screen on the active
  // Space and off screen from another one.
  for (const [onscreen, height] of [
    [true, 320],
    [true, 304],
    [false, 304]
  ]) {
    const verdict = judgeNativeWindows([win('', onscreen, 260, height)])

    assert.equal(verdict.status, 'fail')
    assert.match(verdict.detail, new RegExp(`260 by ${height}`))
    assert.match(verdict.detail, /native dialog blocking startup/)
  }
})

test('every healthy window set measured on macOS passes', () => {
  const measured = {
    chrome: [
      win('', false, 500, 500),
      strip,
      strip,
      win('', false, 1, 1),
      win('Welcome to Extension.js', false, 1200, 905)
    ],
    opera: [
      win('', false, 500, 500),
      strip,
      win('', false, 1029, 592),
      win('Welcome to Extension.js', true, 1089, 711),
      win('', false, 1, 1)
    ],
    vivaldi: [
      strip,
      strip,
      win('Welcome to Extension.js - Vivaldi', true, 1440, 905)
    ],
    yandex: [win('', false, 416, 183), win('Yandex', true, 1200, 900)]
  }

  for (const [browser, windows] of Object.entries(measured)) {
    assert.equal(judgeNativeWindows(windows).status, 'pass', browser)
  }
})

test('an untitled window on screen next to a titled one is reported, not failed', () => {
  const verdict = judgeNativeWindows([
    win('Extensions - Opera', true, 1089, 711),
    win('', true, 260, 320)
  ])

  assert.equal(verdict.status, 'pass')
  assert.match(
    verdict.detail,
    /untitled 260 by 320 \(on screen\) window sits next to "Extensions - Opera"/
  )
})

test('helper sized windows on screen never count as a dialog', () => {
  assert.equal(
    judgeNativeWindows([win('', true, 1512, 33), win('', true, 1, 1)]).status,
    'pass'
  )

  assert.equal(judgeNativeWindows([]).status, 'pass')
})

test('the native dialog check says why it cannot run instead of passing', () => {
  const listing = {screenAccess: true, windows: []}

  assert.match(
    nativeWindowSkipReason({
      platform: 'linux',
      argvText: '/bin/opera',
      listing
    }),
    /only read on macOS, this is linux/
  )

  assert.match(
    nativeWindowSkipReason({
      platform: 'darwin',
      argvText: '/Applications/Opera.app/Contents/MacOS/Opera --headless=new',
      listing
    }),
    /headless/
  )

  assert.match(
    nativeWindowSkipReason({
      platform: 'darwin',
      argvText: '/x/Opera',
      listing: null
    }),
    /did not answer/
  )

  assert.match(
    nativeWindowSkipReason({
      platform: 'darwin',
      argvText: '/x/Opera',
      listing: {screenAccess: false, windows: []}
    }),
    /Screen Recording/
  )

  assert.equal(
    nativeWindowSkipReason({platform: 'darwin', argvText: '/x/Opera', listing}),
    null
  )
})

test('headless is read off the argv in both spellings and nowhere else', () => {
  assert.equal(argvIsHeadless('/x/chrome --headless=new --foo'), true)
  assert.equal(argvIsHeadless('/x/chrome --headless'), true)
  assert.equal(argvIsHeadless('/x/firefox -headless -profile /p'), true)
  assert.equal(
    argvIsHeadless('/x/chrome --user-data-dir=/p/headless-run'),
    false
  )

  assert.equal(argvIsHeadless(null), false)
})

const OPERA_ARGV =
  '/Applications/Opera.app/Contents/MacOS/Opera --load-extension=/w t/extension-js-devtools/chromium,/p/dist/opera --user-data-dir=/p/profile --no-first-run'

test('the --load-extension value is split on commas and survives a space in a path', () => {
  assert.deepEqual(loadExtensionPaths(OPERA_ARGV), [
    '/w t/extension-js-devtools/chromium',
    '/p/dist/opera'
  ])

  assert.deepEqual(loadExtensionPaths('/x/Opera --no-first-run'), [])
  assert.deepEqual(loadExtensionPaths('/x/Opera --load-extension=/a,/b'), [
    '/a',
    '/b'
  ])
})

test('the theme companion on an Opera command line is named', () => {
  assert.deepEqual(themeCompanionPaths(OPERA_ARGV), [])
  assert.deepEqual(
    themeCompanionPaths(
      OPERA_ARGV.replace(
        '/p/dist/opera',
        '/p/dist/opera,/w t/extension-js-theme/chromium'
      )
    ),
    ['/w t/extension-js-theme/chromium']
  )

  // A user project that merely mentions the name in a folder is not it.
  assert.deepEqual(
    themeCompanionPaths(
      '/x/Opera --load-extension=/p/my-extension-js-theme-fork'
    ),
    []
  )
})
