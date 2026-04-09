import {afterEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'
import * as ensureModule from '../../run-chromium/chromium-source-inspection/cdp-extension-controller/ensure'

describe('CDPExtensionController ensureLoaded', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      try {
        fs.rmSync(dir, {recursive: true, force: true})
      } catch {
        // ignore cleanup failures
      }
    }
  })

  it('skips loadUnpacked when user extension path is already preloaded', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-controller-')
    )
    tempDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        name: 'User Extension',
        version: '1.0.0',
        manifest_version: 3
      }),
      'utf-8'
    )

    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222,
      extensionPaths: [outPath]
    }) as any

    controller.cdp = {
      getExtensionInfo: vi.fn(async () => ({
        extensionInfo: {name: 'User Extension', version: '1.0.0'}
      }))
    }
    controller.deriveExtensionIdFromTargets = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('userid')
    controller.enableLogging = vi.fn(async () => {})

    const loadUnpackedSpy = vi.spyOn(ensureModule, 'loadUnpackedIfNeeded')

    const info = await controller.ensureLoaded()

    expect(info.extensionId).toBe('userid')
    expect(loadUnpackedSpy).not.toHaveBeenCalled()
  })

  it('drops mismatched derived extension id and re-derives user id from profile', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-controller-owned-')
    )
    tempDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        name: 'User Extension',
        version: '1.0.0',
        manifest_version: 3
      }),
      'utf-8'
    )

    const managerPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-controller-manager-')
    )
    tempDirs.push(managerPath)

    const profilePath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-controller-profile-')
    )
    tempDirs.push(profilePath)
    const defaultDir = path.join(profilePath, 'Default')
    fs.mkdirSync(defaultDir, {recursive: true})
    fs.writeFileSync(
      path.join(defaultDir, 'Preferences'),
      JSON.stringify({
        extensions: {
          settings: {
            managerid: {path: managerPath},
            userid: {path: outPath}
          }
        }
      }),
      'utf-8'
    )

    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222,
      profilePath,
      extensionPaths: [outPath]
    }) as any

    const getExtensionInfo = vi.fn(async (id: string) => ({
      extensionInfo: {
        name: id === 'userid' ? 'User Extension' : 'Manager Extension',
        version: '1.0.0'
      }
    }))
    controller.cdp = {getExtensionInfo}
    controller.extensionId = 'managerid'
    controller.deriveExtensionIdFromTargets = vi.fn(async () => 'userid')
    controller.enableLogging = vi.fn(async () => {})

    const info = await controller.ensureLoaded()

    expect(info.extensionId).toBe('userid')
    expect(controller.deriveExtensionIdFromTargets).toHaveBeenCalled()
    expect(getExtensionInfo).toHaveBeenCalledWith('userid')
  })
})
