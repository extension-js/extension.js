import {afterEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'
import * as ensureModule from '../../run-chromium/chromium-source-inspection/cdp-extension-controller/ensure'

describe('CDPExtensionController CDP-first loading', () => {
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

  it('uses Extensions.loadUnpacked result when CDP returns an extension ID', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-first-success-')
    )
    tempDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        name: 'Test Extension',
        version: '2.0.0',
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
        extensionInfo: {name: 'Test Extension', version: '2.0.0'}
      })),
      sendCommand: vi.fn(async () => ({extensionId: 'cdp-loaded-id'}))
    }
    controller.enableLogging = vi.fn(async () => {})
    controller.extensionIdBelongsToOutPath = vi.fn(() => true)

    // deriveExtensionIdFromTargets should NOT be called if loadUnpacked succeeds
    controller.deriveExtensionIdFromTargets = vi.fn(async () => 'fallback-id')

    const info = await controller.ensureLoaded()

    expect(info.extensionId).toBe('cdp-loaded-id')
    // Target derivation was not needed since CDP returned an ID
    expect(controller.deriveExtensionIdFromTargets).not.toHaveBeenCalled()
  })

  it('falls back to target derivation when Extensions.loadUnpacked is unavailable', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-first-fallback-')
    )
    tempDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        name: 'Fallback Extension',
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
        extensionInfo: {name: 'Fallback Extension', version: '1.0.0'}
      })),
      // Simulate older Chrome without Extensions.loadUnpacked
      sendCommand: vi.fn(async () => {
        throw new Error("'Extensions.loadUnpacked' wasn't found")
      })
    }
    controller.enableLogging = vi.fn(async () => {})
    controller.extensionIdBelongsToOutPath = vi.fn(() => true)
    controller.deriveExtensionIdFromTargets = vi
      .fn()
      .mockResolvedValue('target-derived-id')

    const loadUnpackedSpy = vi.spyOn(ensureModule, 'loadUnpackedIfNeeded')

    const info = await controller.ensureLoaded()

    expect(info.extensionId).toBe('target-derived-id')
    // loadUnpacked was attempted first (CDP-first strategy)
    expect(loadUnpackedSpy).toHaveBeenCalled()
    // Then fell back to target derivation
    expect(controller.deriveExtensionIdFromTargets).toHaveBeenCalled()
  })

  it('does not call loadUnpacked again when extensionId is already set', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ext-cdp-first-cached-')
    )
    tempDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        name: 'Cached Extension',
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

    // Pre-set the extension ID (simulates a previous successful load)
    controller.extensionId = 'already-known-id'
    controller.cdp = {
      getExtensionInfo: vi.fn(async () => ({
        extensionInfo: {name: 'Cached Extension', version: '1.0.0'}
      }))
    }
    controller.extensionIdBelongsToOutPath = vi.fn(() => true)

    const loadUnpackedSpy = vi.spyOn(ensureModule, 'loadUnpackedIfNeeded')

    const info = await controller.ensureLoaded()

    expect(info.extensionId).toBe('already-known-id')
    // Should skip loadUnpacked since ID was already known
    expect(loadUnpackedSpy).not.toHaveBeenCalled()
  })
})
