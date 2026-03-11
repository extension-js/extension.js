import {afterEach, describe, expect, it} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'

describe('CDPExtensionController developer mode status', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      try {
        fs.rmSync(dir, {recursive: true, force: true})
      } catch {
        // ignore cleanup failures
      }
    }
  })

  it('reads developer mode enabled from Chromium profile preferences', () => {
    const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-dev-mode-on-'))
    tempDirs.push(profilePath)

    const defaultDir = path.join(profilePath, 'Default')
    fs.mkdirSync(defaultDir, {recursive: true})
    fs.writeFileSync(
      path.join(defaultDir, 'Preferences'),
      JSON.stringify({
        extensions: {
          developer_mode: true,
          ui: {developer_mode: true}
        }
      }),
      'utf-8'
    )

    const controller = new CDPExtensionController({
      outPath: '/tmp/out',
      browser: 'chrome',
      cdpPort: 9222,
      profilePath
    })

    expect(controller.getDeveloperModeStatus()).toBe('enabled')
  })

  it('reads developer mode disabled from Chromium profile preferences', () => {
    const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-dev-mode-off-'))
    tempDirs.push(profilePath)

    const defaultDir = path.join(profilePath, 'Default')
    fs.mkdirSync(defaultDir, {recursive: true})
    fs.writeFileSync(
      path.join(defaultDir, 'Preferences'),
      JSON.stringify({
        extensions: {
          developer_mode: false,
          ui: {developer_mode: false}
        }
      }),
      'utf-8'
    )

    const controller = new CDPExtensionController({
      outPath: '/tmp/out',
      browser: 'chrome',
      cdpPort: 9222,
      profilePath
    })

    expect(controller.getDeveloperModeStatus()).toBe('disabled')
  })

  it('returns unknown when no Chromium developer mode preference is present', () => {
    const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-dev-mode-unknown-'))
    tempDirs.push(profilePath)

    const defaultDir = path.join(profilePath, 'Default')
    fs.mkdirSync(defaultDir, {recursive: true})
    fs.writeFileSync(
      path.join(defaultDir, 'Preferences'),
      JSON.stringify({
        extensions: {
          settings: {}
        }
      }),
      'utf-8'
    )

    const controller = new CDPExtensionController({
      outPath: '/tmp/out',
      browser: 'chrome',
      cdpPort: 9222,
      profilePath
    })

    expect(controller.getDeveloperModeStatus()).toBe('unknown')
  })
})
