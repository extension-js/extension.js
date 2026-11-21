import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {CompilationLike, PluginInterface} from '../../browsers-types'
import {
  applyLaunchModeFlags,
  browserConfig,
  DEFAULT_BROWSER_FLAGS
} from '../../run-chromium/chromium-launch/browser-config'

const CLEAR_WEBDRIVER = '--disable-blink-features=AutomationControlled'

let project: string

function makeCompilation(): CompilationLike {
  return {
    options: {
      mode: 'development',
      output: {path: path.join(project, 'dist', 'chrome')}
    }
  }
}

function launchFlags(options: Partial<PluginInterface> = {}) {
  return browserConfig(
    makeCompilation(),
    {extension: '/ext', browser: 'chrome', ...options},
    {provision: false, cdp: true}
  )
}

describe('Chromium launch flags for headed and headless sessions', () => {
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-launch-mode-'))
    vi.stubEnv('EXTENSION_HEADLESS', undefined)
    vi.stubEnv('EXTENSION_BROWSER_FLAGS', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(project, {recursive: true, force: true})
  })

  it('keeps --mute-audio out of the default list every launch shares', () => {
    expect(DEFAULT_BROWSER_FLAGS.map(String)).not.toContain('--mute-audio')
  })

  it('a headed dev window plays sound and clears navigator.webdriver', () => {
    const flags = launchFlags()

    expect(flags).toContain('--remote-debugging-pipe')
    expect(flags).not.toContain('--mute-audio')
    expect(flags).toContain(CLEAR_WEBDRIVER)
    expect(flags.some((flag) => flag.startsWith('--headless'))).toBe(false)
  })

  it('a headless launch from the guard stays muted and leaves webdriver alone', () => {
    vi.stubEnv('EXTENSION_HEADLESS', '1')
    const flags = launchFlags()

    expect(flags).toContain('--headless=new')
    expect(flags).toContain('--mute-audio')
    expect(flags.some((flag) => flag.includes('AutomationControlled'))).toBe(
      false
    )
  })

  it('a headless launch from EXTENSION_BROWSER_FLAGS stays muted', () => {
    vi.stubEnv('EXTENSION_BROWSER_FLAGS', '--headless=new')
    const flags = launchFlags()

    expect(flags).toContain('--mute-audio')
    expect(flags).not.toContain(CLEAR_WEBDRIVER)
  })

  it('a headless launch from config browserFlags stays muted', () => {
    const flags = launchFlags({browserFlags: ['--headless']})

    expect(flags).toContain('--mute-audio')
  })

  it('a person who passes --mute-audio to a headed window keeps it once', () => {
    const fromConfig = launchFlags({browserFlags: ['--mute-audio']})
    expect(fromConfig.filter((flag) => flag === '--mute-audio')).toHaveLength(1)

    vi.stubEnv('EXTENSION_BROWSER_FLAGS', '--mute-audio')
    const fromEnv = launchFlags()
    expect(fromEnv.filter((flag) => flag === '--mute-audio')).toHaveLength(1)
  })

  it('excludeBrowserFlags can still drop --mute-audio from a headless launch', () => {
    vi.stubEnv('EXTENSION_HEADLESS', '1')
    const flags = launchFlags({excludeBrowserFlags: ['--mute-audio']})

    expect(flags).not.toContain('--mute-audio')
  })

  it('a headed launch that asks for automation keeps navigator.webdriver', () => {
    const viaSwitch = launchFlags({browserFlags: ['--enable-automation']})
    expect(viaSwitch).not.toContain(CLEAR_WEBDRIVER)

    vi.stubEnv(
      'EXTENSION_BROWSER_FLAGS',
      '--enable-blink-features=AutomationControlled'
    )

    const viaBlink = launchFlags()
    expect(viaBlink.some((flag) => flag.startsWith('--disable-blink'))).toBe(
      false
    )
  })

  it('excludeBrowserFlags can drop the webdriver override from a headed launch', () => {
    const flags = launchFlags({excludeBrowserFlags: [CLEAR_WEBDRIVER]})

    expect(flags).not.toContain(CLEAR_WEBDRIVER)
  })

  it('merges a user --disable-blink-features into one switch with the override', () => {
    const flags = launchFlags({
      browserFlags: ['--disable-blink-features=Foo']
    })
    const switches = flags.filter((flag) =>
      flag.startsWith('--disable-blink-features=')
    )

    expect(switches).toEqual([
      '--disable-blink-features=Foo,AutomationControlled'
    ])
  })
})

describe('applyLaunchModeFlags', () => {
  it('leaves an explicit --headless=old launch muted without the override', () => {
    expect(applyLaunchModeFlags(['--headless=old'])).toEqual([
      '--headless=old',
      '--mute-audio'
    ])
  })

  it('adds only the webdriver override to a headed list', () => {
    expect(applyLaunchModeFlags(['--remote-debugging-pipe'])).toEqual([
      '--remote-debugging-pipe',
      CLEAR_WEBDRIVER
    ])
  })

  it('does not duplicate an override the user already passed', () => {
    expect(applyLaunchModeFlags([CLEAR_WEBDRIVER])).toEqual([CLEAR_WEBDRIVER])
  })
})
