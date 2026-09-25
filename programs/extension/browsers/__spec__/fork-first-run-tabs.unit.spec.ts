import {describe, expect, it} from 'vitest'
import {
  CDPExtensionController,
  DEVTOOLS_COMPANION_WELCOME_URL
} from '../run-chromium/cdp/cdp-extension-controller'

const VIVALDI_WIZARD =
  'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/components/welcome/welcome.html'

function controllerWithTargets(targets: unknown[]) {
  const calls: Array<{method: string; params: any; sessionId?: string}> = []
  const controller = new CDPExtensionController({
    outPath: '/p/dist/vivaldi',
    browser: 'chromium-based',
    cdpPort: 9222
  })
  ;(controller as any).cdp = {
    getTargets: async () => targets,
    sendCommand: async (method: string, params: any, sessionId?: string) => {
      calls.push({method, params, sessionId})

      if (method === 'Target.attachToTarget')
        {return {sessionId: `s-${params.targetId}`}}

      return {}
    }
  }

  return {controller, calls}
}

describe("a fork's own onboarding tab on a fresh profile", () => {
  it('repoints the Vivaldi wizard at the companion welcome page, never closing it', async () => {
    const {controller, calls} = controllerWithTargets([
      {targetId: 'wizard', type: 'page', url: VIVALDI_WIZARD},
      {targetId: 'ext', type: 'page', url: 'chrome://extensions/'},
      {targetId: 'sw', type: 'service_worker', url: VIVALDI_WIZARD}
    ])

    await expect(
      controller.replaceForkFirstRunTabs(
        'vivaldi',
        DEVTOOLS_COMPANION_WELCOME_URL
      )
    ).resolves.toBe(1)

    expect(calls.map((c) => c.method)).toEqual([
      'Target.attachToTarget',
      'Page.navigate'
    ])

    expect(calls[0].params).toEqual({targetId: 'wizard', flatten: true})
    expect(calls[1]).toEqual({
      method: 'Page.navigate',
      params: {url: DEVTOOLS_COMPANION_WELCOME_URL},
      sessionId: 's-wizard'
    })

    expect(calls.some((c) => c.method === 'Target.closeTarget')).toBe(false)
  })

  it('does nothing for a browser with no known onboarding surface', async () => {
    const {controller, calls} = controllerWithTargets([
      {targetId: 'wizard', type: 'page', url: VIVALDI_WIZARD}
    ])

    await expect(
      controller.replaceForkFirstRunTabs(
        'chrome',
        DEVTOOLS_COMPANION_WELCOME_URL
      )
    ).resolves.toBe(0)

    expect(calls).toEqual([])
  })

  it('leaves a user page on Vivaldi alone', async () => {
    const {controller, calls} = controllerWithTargets([
      {targetId: 'user', type: 'page', url: 'https://example.com/'},
      {
        targetId: 'ours',
        type: 'page',
        url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/pages/welcome.html'
      }
    ])

    await expect(
      controller.replaceForkFirstRunTabs('vivaldi', 'about:blank')
    ).resolves.toBe(0)

    expect(calls).toEqual([])
  })
})
