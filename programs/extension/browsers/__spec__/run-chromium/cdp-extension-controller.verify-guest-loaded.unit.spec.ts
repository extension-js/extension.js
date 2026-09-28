import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {expectedChromiumExtensionId} from '../../browsers-lib/banner'
import {CDPExtensionController} from '../../run-chromium/cdp/cdp-extension-controller'

const tempDirs: string[] = []

function makeGuestDist(): string {
  const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-verify-guest-'))
  tempDirs.push(outPath)
  fs.writeFileSync(
    path.join(outPath, 'manifest.json'),
    JSON.stringify({
      name: 'User Extension',
      version: '1.0.0',
      manifest_version: 3,
      background: {service_worker: 'sw.js'}
    }),
    'utf-8'
  )

  return outPath
}

function makeController(
  browser: string,
  outPath: string,
  targets: Array<{type: string; url: string}>
) {
  const controller = new CDPExtensionController({
    outPath,
    browser,
    cdpPort: 9222,
    extensionPaths: [outPath]
  }) as any

  controller.cdp = {
    getTargets: vi.fn(async () => targets),
    sendCommand: vi.fn(async () => ({id: 'abcdefghijklmnopabcdefghijklmnop'}))
  }

  return controller
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

describe('verifyGuestLoaded on a browser that ignores --load-extension', () => {
  it('goes straight to Extensions.loadUnpacked without polling for a target', async () => {
    const outPath = makeGuestDist()
    const controller = makeController('yandex', outPath, [])

    const outcome = await controller.verifyGuestLoaded()

    expect(outcome).toEqual({
      status: 'loaded',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop'
    })

    expect(controller.cdp.getTargets).not.toHaveBeenCalled()
    expect(controller.cdp.sendCommand).toHaveBeenCalledWith(
      'Extensions.loadUnpacked',
      {path: outPath}
    )
  })

  it('still looks for the command-line load on chromium before asking', async () => {
    const outPath = makeGuestDist()
    const expectedId = expectedChromiumExtensionId(outPath)
    const controller = makeController('chromium', outPath, [
      {type: 'service_worker', url: `chrome-extension://${expectedId}/sw.js`}
    ])

    const outcome = await controller.verifyGuestLoaded()

    expect(outcome).toEqual({status: 'loaded', extensionId: expectedId})
    expect(controller.cdp.getTargets).toHaveBeenCalledTimes(1)
    expect(controller.cdp.sendCommand).not.toHaveBeenCalled()
  })
})
