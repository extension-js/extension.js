import {describe, expect, it} from 'vitest'
import {CDPExtensionController} from '../run-chromium/cdp/cdp-extension-controller'

const WELCOME =
  'chrome-extension://kgdaecdpfkikjncaalnmmnjjfpofkcbl/pages/welcome.html'

function controllerWithTargets(targets: unknown[]) {
  const closed: string[] = []
  const controller = new CDPExtensionController({
    outPath: '/p/dist/chromium',
    browser: 'chrome',
    cdpPort: 9222
  })

  ;(controller as any).cdp = {
    getTargets: async () => targets,
    sendCommand: async (method: string, params: {targetId: string}) => {
      if (method === 'Target.closeTarget') closed.push(params.targetId)
      return {}
    }
  }

  return {controller, closed}
}

describe('--no-open closes the tabs the session opened for itself', () => {
  it('closes the companion welcome page and the extensions page', async () => {
    const {controller, closed} = controllerWithTargets([
      {targetId: 'a', type: 'page', url: WELCOME},
      {targetId: 'b', type: 'page', url: 'chrome://extensions/'},
      {targetId: 'c', type: 'page', url: 'https://example.com/'}
    ])

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(2)
    expect(closed).toEqual(['a', 'b'])
  })

  it('keeps a user extension welcome page and closes the Edge extensions page', async () => {
    const {controller, closed} = controllerWithTargets([
      {
        targetId: 'user',
        type: 'page',
        url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/pages/welcome.html'
      },
      {targetId: 'edge', type: 'page', url: 'edge://extensions/'}
    ])

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(1)
    expect(closed).toEqual(['edge'])
  })

  it('leaves service workers and other targets alone', async () => {
    const {controller, closed} = controllerWithTargets([
      {targetId: 'sw', type: 'service_worker', url: WELCOME},
      {targetId: 'page', type: 'page', url: 'chrome://newtab/'}
    ])

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(0)
    expect(closed).toEqual([])
  })
})
