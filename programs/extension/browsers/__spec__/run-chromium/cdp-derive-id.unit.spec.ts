import {afterEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {deriveExtensionIdFromTargetsHelper} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller/derive-id'

describe('deriveExtensionIdFromTargetsHelper', () => {
  const createdDirs: string[] = []

  function createExtensionFixture(
    manifest: Record<string, unknown>,
    messages?: Record<string, unknown>
  ) {
    const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-derive-id-'))
    createdDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify(manifest),
      'utf-8'
    )

    if (messages && typeof manifest.default_locale === 'string') {
      const messagesDir = path.join(
        outPath,
        '_locales',
        manifest.default_locale
      )
      fs.mkdirSync(messagesDir, {recursive: true})
      fs.writeFileSync(
        path.join(messagesDir, 'messages.json'),
        JSON.stringify(messages),
        'utf-8'
      )
    }

    return outPath
  }

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of createdDirs.splice(0, createdDirs.length)) {
      try {
        fs.rmSync(dir, {recursive: true, force: true})
      } catch {
        // Ignore cleanup failures in tests.
      }
    }
  })

  it('selects user extension ID when another extension target appears first', async () => {
    const outPath = createExtensionFixture({
      name: 'User Extension',
      version: '1.2.3',
      manifest_version: 3
    })

    const cdp: any = {
      getTargets: vi.fn(async () => [
        {
          targetId: 'target-manager',
          type: 'service_worker',
          url: 'chrome-extension://managerid/background/service_worker.js'
        },
        {
          targetId: 'target-user',
          type: 'service_worker',
          url: 'chrome-extension://userid/background/service_worker.js'
        }
      ]),
      attachToTarget: vi.fn(async (targetId: string) => `session:${targetId}`),
      sendCommand: vi.fn(async () => ({})),
      evaluate: vi.fn(async (sessionId: string) => {
        if (sessionId === 'session:target-manager') {
          return {
            id: 'managerid',
            name: 'Manager Extension',
            version: '9.9.9',
            manifestVersion: 3
          }
        }
        return {
          id: 'userid',
          name: 'User Extension',
          version: '1.2.3',
          manifestVersion: 3
        }
      })
    }

    const id = await deriveExtensionIdFromTargetsHelper(cdp, outPath)
    expect(id).toBe('userid')
  })

  it('resolves __MSG_ manifest name and matches localized evaluated target', async () => {
    const outPath = createExtensionFixture(
      {
        name: '__MSG_extName__',
        version: '2.0.0',
        manifest_version: 3,
        default_locale: 'en'
      },
      {
        extName: {message: 'Localized User Extension'}
      }
    )

    const cdp: any = {
      getTargets: vi.fn(async () => [
        {
          targetId: 'target-user',
          type: 'service_worker',
          url: 'chrome-extension://userid/background/service_worker.js'
        }
      ]),
      attachToTarget: vi.fn(async (targetId: string) => `session:${targetId}`),
      sendCommand: vi.fn(async () => ({})),
      evaluate: vi.fn(async () => ({
        id: 'userid',
        name: 'Localized User Extension',
        version: '2.0.0',
        manifestVersion: 3
      }))
    }

    const id = await deriveExtensionIdFromTargetsHelper(cdp, outPath)
    expect(id).toBe('userid')
  })

  it('prefers profile/path-derived user ID over ambiguous evaluated targets', async () => {
    const userOutPath = createExtensionFixture({
      name: 'User Extension',
      version: '1.2.3',
      manifest_version: 3
    })
    const managerOutPath = createExtensionFixture({
      name: 'Manager Extension',
      version: '9.9.9',
      manifest_version: 3
    })

    const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-profile-'))
    createdDirs.push(profilePath)
    const prefs = {
      extensions: {
        settings: {
          managerid: {
            path: managerOutPath,
            manifest: {name: 'Manager Extension', version: '9.9.9'}
          },
          userid: {
            path: userOutPath,
            manifest: {name: 'User Extension', version: '1.2.3'}
          }
        }
      }
    }
    fs.writeFileSync(
      path.join(profilePath, 'Preferences'),
      JSON.stringify(prefs),
      'utf-8'
    )

    const cdp: any = {
      getTargets: vi.fn(async () => [
        {
          targetId: 'target-manager',
          type: 'service_worker',
          url: 'chrome-extension://managerid/background/service_worker.js'
        },
        {
          targetId: 'target-user',
          type: 'service_worker',
          url: 'chrome-extension://userid/background/service_worker.js'
        }
      ]),
      attachToTarget: vi.fn(async (targetId: string) => `session:${targetId}`),
      sendCommand: vi.fn(async () => ({})),
      evaluate: vi.fn(async (sessionId: string) => {
        if (sessionId === 'session:target-manager') {
          // Intentionally mimic user name/version to create ambiguity.
          return {
            id: 'managerid',
            name: 'User Extension',
            version: '1.2.3',
            manifestVersion: 3
          }
        }
        return {
          id: 'userid',
          name: 'User Extension',
          version: '1.2.3',
          manifestVersion: 3
        }
      })
    }

    const id = await deriveExtensionIdFromTargetsHelper(
      cdp,
      userOutPath,
      6,
      10,
      profilePath,
      [userOutPath]
    )
    expect(id).toBe('userid')
  })

  it('retries when only non-matching extension target appears initially', async () => {
    const outPath = createExtensionFixture({
      name: 'User Extension',
      version: '1.2.3',
      manifest_version: 3
    })

    let targetCall = 0
    const cdp: any = {
      getTargets: vi.fn(async () => {
        targetCall += 1
        if (targetCall === 1) {
          return [
            {
              targetId: 'target-manager',
              type: 'service_worker',
              url: 'chrome-extension://managerid/background/service_worker.js'
            }
          ]
        }
        return [
          {
            targetId: 'target-manager',
            type: 'service_worker',
            url: 'chrome-extension://managerid/background/service_worker.js'
          },
          {
            targetId: 'target-user',
            type: 'service_worker',
            url: 'chrome-extension://userid/background/service_worker.js'
          }
        ]
      }),
      attachToTarget: vi.fn(async (targetId: string) => `session:${targetId}`),
      sendCommand: vi.fn(async () => ({})),
      evaluate: vi.fn(async (sessionId: string) => {
        if (sessionId === 'session:target-manager') {
          return {
            id: 'managerid',
            name: 'Manager Extension',
            version: '9.9.9',
            manifestVersion: 3
          }
        }
        return {
          id: 'userid',
          name: 'User Extension',
          version: '1.2.3',
          manifestVersion: 3
        }
      })
    }

    const id = await deriveExtensionIdFromTargetsHelper(cdp, outPath, 2, 1)
    expect(id).toBe('userid')
    expect(cdp.getTargets).toHaveBeenCalledTimes(2)
  })
})
