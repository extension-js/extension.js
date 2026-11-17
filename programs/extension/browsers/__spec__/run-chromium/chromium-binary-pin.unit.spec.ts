import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../../run-chromium/chromium-launch'
import {type FakeChromium, fakeChromium} from '../fake-browser'

describe('ChromiumLaunchPlugin --chromium-binary', () => {
  let fake: FakeChromium

  beforeEach(async () => {
    fake = await fakeChromium()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    await fake.close()
    vi.restoreAllMocks()
  })

  const launcher = (chromiumBinary: string) =>
    new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: [fake.project.out],
        chromiumBinary
      } as never,
      createChromiumContext() as never,
      fake.deps
    )

  it('rejects a missing pin on chrome instead of asking to install Chrome for Testing', async () => {
    const missing = join(fake.project.root, 'no', 'such', 'canary')
    const thrown = await launcher(missing)
      .runOnce(fake.project.compilation() as never)
      .then(() => undefined)
      .catch((err: Error & {code?: string}) => err)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.code).toBe('E_BROWSER_BINARY_INVALID')
    expect(thrown?.message).toMatch(
      /Can't find a Chromium binary at the given path/
    )

    expect(thrown?.message).not.toMatch(/Chrome for Testing/)
    expect(thrown?.message).not.toMatch(/npx extension install chrome/)
    expect(fake.located).toEqual([])
    expect(fake.offeredInstalls).toEqual([])
    expect(fake.spawns).toEqual([])
  })

  it('runs the named pin on chrome and never scans the system for another', async () => {
    const pin = fake.project.plantBinary('canary')

    await launcher(pin).runOnce(fake.project.compilation() as never, {
      enableCdpPostLaunch: false
    })

    expect(fake.spawns.map((spawn) => spawn.binary)).toEqual([pin])
    expect(fake.probed).toEqual([pin])
    expect(fake.located).toEqual([])
  })
})
