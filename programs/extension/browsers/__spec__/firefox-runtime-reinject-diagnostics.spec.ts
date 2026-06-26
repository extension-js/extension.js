import {describe, it, expect, vi, afterEach} from 'vitest'
import {reinjectMatchingTabsViaAddonRuntime} from '../run-firefox/firefox-source-inspection/remote-firefox/runtime-reinject'

const prevAuthorMode = process.env.EXTENSION_AUTHOR_MODE

const makeOpts = () => ({
  outPath: '/does/not/exist',
  rules: [{index: 0, world: 'extension', matches: ['*://*/*']}],
  addonsActor: 'addons-actor',
  addonId: 'demo-addon',
  matchUrl: () => true
})

const makeClient = () => ({
  getTargets: vi.fn(async () => {
    throw new Error('RDP session torn down')
  })
})

describe('reinjectMatchingTabsViaAddonRuntime diagnostics (unit)', () => {
  afterEach(() => {
    if (prevAuthorMode === undefined) delete process.env.EXTENSION_AUTHOR_MODE
    else process.env.EXTENSION_AUTHOR_MODE = prevAuthorMode
    vi.restoreAllMocks()
  })

  it('reports a torn-down tab list under author mode instead of swallowing it', async () => {
    process.env.EXTENSION_AUTHOR_MODE = 'true'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await reinjectMatchingTabsViaAddonRuntime(
      makeClient() as any,
      makeOpts() as any
    )

    expect(result.report.phase).toBe('skipped')
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes('could not list tabs')
      )
    ).toBe(true)
  })

  it('stays silent when author mode is off', async () => {
    delete process.env.EXTENSION_AUTHOR_MODE
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await reinjectMatchingTabsViaAddonRuntime(
      makeClient() as any,
      makeOpts() as any
    )

    expect(result.report.phase).toBe('skipped')
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes('could not list tabs')
      )
    ).toBe(false)
  })
})
