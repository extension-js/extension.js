import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {expectedChromiumExtensionId} from '../browsers-lib/banner'
import {CDPExtensionController} from '../run-chromium/cdp/cdp-extension-controller'

const COMPANION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAllbZJQG6Sfby1qyGr2pyR5JktAOh44tJMD1fm4Svk0JF/8TYwTTugJaFTPZoCepdgNU8gwc+jixaleQHOKNxmm2g1aV0eW8XSv4Mk+QM3//l9ftwvyoE/Z7vcwI1KT+OxUAoq6RUuQVjm007c4/mE3TiH83Atubrhp6eFVX7BfLAD49SNlpSvaK+Y8QgsJcmjQmLiUpkd4w9kWT3pk0Gn2Ytjz9spPurhdnFatwMuATQggazmS+lq0chGLzlznWN64lZER3iQ/gv30Z1DHGAPyOlf1w4YgVortWnbqrkIKzpCnymW2z8sj1BQMknaBW3katl20gg2DnpX4acsCzwYQIDAQAB'
const PINNED_ID = 'kgdaecdpfkikjncaalnmmnjjfpofkcbl'
const USER_WELCOME =
  'chrome-extension://abcdefghijklmnopabcdefghijklmnop/pages/welcome.html'

let root: string
let keyedCompanion: string
let keylessCompanion: string

function writeCompanion(engine: string, extra: Record<string, string>) {
  const dir = path.join(root, 'extension-js-devtools', 'dist', engine)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Extension.js',
      version: '1.0',
      ...extra
    })
  )

  return dir
}

function welcomeOf(extensionId: string) {
  return `chrome-extension://${extensionId}/pages/welcome.html`
}

function controllerWithTargets(targets: unknown[], companionPath?: string) {
  const closed: string[] = []
  const controller = new CDPExtensionController({
    outPath: path.join(root, 'dist', 'chromium'),
    browser: 'chrome',
    cdpPort: 9222,
    companionPath
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

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-open-self-opened-tabs-'))
  keyedCompanion = writeCompanion('chromium', {key: COMPANION_KEY})
  keylessCompanion = writeCompanion('edge', {})
})

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('--no-open closes the tabs the session opened for itself', () => {
  it('closes the companion welcome page on the id its manifest key pins', async () => {
    expect(expectedChromiumExtensionId(keyedCompanion)).toBe(PINNED_ID)

    const {controller, closed} = controllerWithTargets(
      [
        {targetId: 'a', type: 'page', url: welcomeOf(PINNED_ID)},
        {targetId: 'b', type: 'page', url: 'chrome://extensions/'},
        {targetId: 'c', type: 'page', url: 'https://example.com/'}
      ],
      keyedCompanion
    )

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(2)
    expect(closed).toEqual(['a', 'b'])
  })

  it('closes the companion welcome page on the id the browser hashes from its path when the manifest has no key', async () => {
    const hashedId = expectedChromiumExtensionId(keylessCompanion)

    expect(hashedId).toMatch(/^[a-p]{32}$/)
    expect(hashedId).not.toBe(PINNED_ID)

    const {controller, closed} = controllerWithTargets(
      [
        {targetId: 'hashed', type: 'page', url: welcomeOf(hashedId)},
        {targetId: 'pinned', type: 'page', url: welcomeOf(PINNED_ID)},
        {targetId: 'edge', type: 'page', url: 'edge://extensions/'}
      ],
      keylessCompanion
    )

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(2)
    expect(closed).toEqual(['hashed', 'edge'])
  })

  it('keeps every welcome page when no companion is in the load list', async () => {
    const {controller, closed} = controllerWithTargets([
      {targetId: 'pinned', type: 'page', url: welcomeOf(PINNED_ID)},
      {targetId: 'ext', type: 'page', url: 'chrome://extensions/'}
    ])

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(1)
    expect(closed).toEqual(['ext'])
  })

  it('keeps a user extension welcome page and closes the Edge extensions page', async () => {
    const {controller, closed} = controllerWithTargets(
      [
        {targetId: 'user', type: 'page', url: USER_WELCOME},
        {targetId: 'edge', type: 'page', url: 'edge://extensions/'}
      ],
      keyedCompanion
    )

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(1)
    expect(closed).toEqual(['edge'])
  })

  it('leaves service workers and other targets alone', async () => {
    const {controller, closed} = controllerWithTargets(
      [
        {targetId: 'sw', type: 'service_worker', url: welcomeOf(PINNED_ID)},
        {targetId: 'page', type: 'page', url: 'chrome://newtab/'}
      ],
      keyedCompanion
    )

    await expect(controller.closeSelfOpenedTabs()).resolves.toBe(0)
    expect(closed).toEqual([])
  })
})
