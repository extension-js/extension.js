import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CDPExtensionController} from '../../run-chromium/cdp/cdp-extension-controller'
import * as ensureModule from '../../run-chromium/cdp/cdp-extension-controller/ensure'
import {codedError} from '../../run-chromium/cdp/coded-error'

describe('CDPExtensionController ensureLoaded', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      try {
        fs.rmSync(dir, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })

  it('tries CDP-first loadUnpacked, then falls back to target derivation', async () => {
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
      })),
      sendCommand: vi.fn(async () => {
        throw new Error("'Extensions.loadUnpacked' wasn't found")
      })
    }

    controller.deriveExtensionIdFromTargets = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('userid')

    controller.enableLogging = vi.fn(async () => {})

    const loadUnpackedSpy = vi.spyOn(ensureModule, 'loadUnpackedIfNeeded')

    const info = await controller.ensureLoaded()

    expect(info.extensionId).toBe('userid')
    expect(loadUnpackedSpy).toHaveBeenCalled()
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

  function unloadableController(
    deriveExtensionIdFromTargets: () => Promise<string | null>
  ) {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-controller-codes-')
    )
    tempDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({name: 'User Extension', version: '1.0.0'}),
      'utf-8'
    )

    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222,
      extensionPaths: [outPath]
    }) as any

    controller.cdp = {
      getExtensionInfo: vi.fn(async () => null),
      sendCommand: vi.fn(async () => {
        throw new Error("'Extensions.loadUnpacked' wasn't found")
      })
    }

    controller.deriveExtensionIdFromTargets = vi.fn(
      deriveExtensionIdFromTargets
    )

    controller.enableLogging = vi.fn(async () => {})

    return {controller, outPath}
  }

  const rejection = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error as Error & {code?: string}
    )

  it('refuses with E_CDP_NOT_CONNECTED before a client is attached', async () => {
    const controller = new CDPExtensionController({
      outPath: os.tmpdir(),
      browser: 'chrome',
      cdpPort: 9222,
      extensionPaths: []
    })

    const error = await rejection(controller.ensureLoaded())

    expect(error?.message).toBe('CDP not connected')
    expect(error?.code).toBe('E_CDP_NOT_CONNECTED')
    expect(() => controller.onProtocolEvent(() => {})).toThrow(
      expect.objectContaining({code: 'E_CDP_NOT_CONNECTED'})
    )
  })

  it('codes an id that never resolved as E_EXTENSION_ID_UNKNOWN through the load wrap', async () => {
    const {controller, outPath} = unloadableController(async () => null)

    const error = await rejection(controller.ensureLoaded())

    expect(error?.message).toContain(
      `Failed to load extension from ${path.resolve(outPath)}`
    )

    expect(error?.message).toContain('Failed to determine extension ID via CDP')
    expect(error?.code).toBe('E_EXTENSION_ID_UNKNOWN')
  })

  it('keeps the code a derivation failure was thrown with over the load wrap', async () => {
    const derive = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(
        codedError(
          'E_CDP_TIMEOUT',
          'CDP command timed out (10ms): Target.getTargets'
        )
      )
    const {controller} = unloadableController(derive)

    const error = await rejection(controller.ensureLoaded())

    expect(error?.message).toContain('Failed to load extension from')
    expect(error?.code).toBe('E_CDP_TIMEOUT')
  })

  it('codes a bare failure inside the load as E_CDP_OP_FAILED', async () => {
    const derive = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('targets unreadable'))
    const {controller} = unloadableController(derive)

    const error = await rejection(controller.ensureLoaded())

    expect(error?.message).toContain('targets unreadable')
    expect(error?.code).toBe('E_CDP_OP_FAILED')
  })
})
