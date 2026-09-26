import {describe, expect, it} from 'vitest'
import {
  chromiumLaunchPlan,
  defaultStartingUrlForBrowser
} from '../run-chromium/chromium-launch/browser-config'

const COMPANION = '/tmp/pkg/extension-js-devtools/chromium'
const USER_DIST = '/tmp/project/dist/yandex'
const FLAGS = [
  '--no-first-run',
  `--load-extension=${COMPANION},${USER_DIST}`,
  '--user-data-dir=/tmp/profile'
]

describe('starting url for a browser with no new tab page at startup', () => {
  it('points Yandex at the companion welcome page', () => {
    const url = defaultStartingUrlForBrowser('yandex', FLAGS)

    expect(url).toMatch(
      /^chrome-extension:\/\/[a-p]{32}\/pages\/welcome\.html$/
    )
  })

  it('leaves every other chromium target alone', () => {
    for (const other of [
      'chrome',
      'chromium',
      'edge',
      'brave',
      'vivaldi',
      'opera'
    ]) {
      expect(defaultStartingUrlForBrowser(other, FLAGS)).toBeUndefined()
    }

    expect(defaultStartingUrlForBrowser(undefined, FLAGS)).toBeUndefined()
  })

  it('adds nothing when the companion is not being loaded', () => {
    const noCompanion = [`--load-extension=${USER_DIST}`]

    expect(defaultStartingUrlForBrowser('yandex', noCompanion)).toBeUndefined()
    expect(defaultStartingUrlForBrowser('yandex', [])).toBeUndefined()
  })

  it('appends the url as the positional argument for Yandex', () => {
    const {args} = chromiumLaunchPlan(
      '/bin/yandex',
      FLAGS,
      undefined,
      false,
      'yandex'
    )

    expect(args.slice(0, FLAGS.length)).toEqual(FLAGS)
    expect(args).toHaveLength(FLAGS.length + 1)
    expect(args[args.length - 1]).toContain('/pages/welcome.html')
  })

  it('lets a url the user asked for win', () => {
    const {args} = chromiumLaunchPlan(
      '/bin/yandex',
      FLAGS,
      'https://example.com/',
      false,
      'yandex'
    )

    expect(args[args.length - 1]).toBe('https://example.com/')
  })

  it('keeps --no-open free of any url', () => {
    const {args} = chromiumLaunchPlan(
      '/bin/yandex',
      FLAGS,
      undefined,
      true,
      'yandex'
    )

    expect(args).toEqual(FLAGS)
  })
})
