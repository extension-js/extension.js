import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {FirefoxLaunchPlugin} from '../run-firefox/firefox-launch'
import {resolveFirefoxLaunchConfig} from '../run-firefox/firefox-launch/browser-config'

describe('firefox dev on its own profile', () => {
  let scratch: string
  const envBefore = process.env.EXTENSION_USE_SYSTEM_PROFILE

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fx-system-'))
  })

  afterEach(() => {
    fs.rmSync(scratch, {recursive: true, force: true})
    if (envBefore === undefined) delete process.env.EXTENSION_USE_SYSTEM_PROFILE
    else process.env.EXTENSION_USE_SYSTEM_PROFILE = envBefore

    vi.restoreAllMocks()
  })

  it('resolves no profile path, so there is nothing to install the add-on into', async () => {
    process.env.EXTENSION_USE_SYSTEM_PROFILE = 'true'
    const project = path.join(scratch, 'project')
    const launch = await resolveFirefoxLaunchConfig(
      {
        options: {
          context: project,
          output: {path: path.join(project, 'dist', 'firefox')}
        }
      } as any,
      {extension: '/ext', browser: 'firefox', profile: false} as any
    )

    expect(launch.profilePath).toBeFalsy()
  })

  it('warns that nothing loaded instead of printing the ready line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = new FirefoxLaunchPlugin(
      {browser: 'firefox'} as any,
      {logger: undefined} as any
    )
    ;(plugin as any).addonNotInstalled = true
    ;(plugin as any).reportReady('development')

    const printed = [...log.mock.calls, ...warn.mock.calls]
      .map((call) => String(call[0]))
      .join('\n')

    expect(printed).not.toMatch(/ready for development/)
    expect(printed).toContain(
      'Firefox is running with its own profile, so the add-on was not installed'
    )

    expect(printed).toContain('Drop --profile=false')
  })

  it('still prints the ready line when the add-on was installed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const plugin = new FirefoxLaunchPlugin(
      {browser: 'firefox'} as any,
      {logger: undefined} as any
    )
    ;(plugin as any).reportReady('development')

    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(
      /ready for development/
    )
  })
})
