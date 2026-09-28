import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {expectedChromiumExtensionId} from '../browsers-lib/banner'
import {
  CDPExtensionController,
  devtoolsCompanionWelcomeUrl
} from '../run-chromium/cdp/cdp-extension-controller'

const VIVALDI_WIZARD =
  'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/components/welcome/welcome.html'
const PINNED_ID = 'kgdaecdpfkikjncaalnmmnjjfpofkcbl'

let root: string
let keylessCompanion: string

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

      if (method === 'Target.attachToTarget') {
        return {sessionId: `s-${params.targetId}`}
      }

      return {}
    }
  }

  return {controller, calls}
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-first-run-tabs-'))
  keylessCompanion = path.join(root, 'extension-js-devtools', 'dist', 'edge')
  fs.mkdirSync(keylessCompanion, {recursive: true})
  fs.writeFileSync(
    path.join(keylessCompanion, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'Extension.js', version: '1.0'})
  )
})

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('the companion welcome url', () => {
  it('carries the id the browser hashes from the path when the manifest has no key', () => {
    const hashedId = expectedChromiumExtensionId(keylessCompanion)

    expect(hashedId).toMatch(/^[a-p]{32}$/)
    expect(hashedId).not.toBe(PINNED_ID)
    expect(devtoolsCompanionWelcomeUrl(keylessCompanion)).toBe(
      `chrome-extension://${hashedId}/pages/welcome.html`
    )
  })
})

describe("a fork's own onboarding tab on a fresh profile", () => {
  it('repoints the Vivaldi wizard at the companion welcome page, never closing it', async () => {
    const welcomeUrl = devtoolsCompanionWelcomeUrl(keylessCompanion)
    const {controller, calls} = controllerWithTargets([
      {targetId: 'wizard', type: 'page', url: VIVALDI_WIZARD},
      {targetId: 'ext', type: 'page', url: 'chrome://extensions/'},
      {targetId: 'sw', type: 'service_worker', url: VIVALDI_WIZARD}
    ])

    await expect(
      controller.replaceForkFirstRunTabs('vivaldi', welcomeUrl)
    ).resolves.toBe(1)

    expect(calls.map((c) => c.method)).toEqual([
      'Target.attachToTarget',
      'Page.navigate'
    ])

    expect(calls[0].params).toEqual({targetId: 'wizard', flatten: true})
    expect(calls[1]).toEqual({
      method: 'Page.navigate',
      params: {url: welcomeUrl},
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
        devtoolsCompanionWelcomeUrl(keylessCompanion)
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
