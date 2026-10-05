import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {FirefoxLaunchPlugin} from '../run-firefox/firefox-launch'
import {resolveFirefoxLaunchConfig} from '../run-firefox/firefox-launch/browser-config'

describe('firefox on its own profile', () => {
  let scratch: string
  const envBefore = process.env.EXTENSION_USE_SYSTEM_PROFILE
  const legacyEnvBefore = process.env.EXTJS_USE_SYSTEM_PROFILE

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fx-system-'))
    delete process.env.EXTENSION_USE_SYSTEM_PROFILE
    delete process.env.EXTJS_USE_SYSTEM_PROFILE
  })

  afterEach(() => {
    fs.rmSync(scratch, {recursive: true, force: true})
    if (envBefore === undefined) delete process.env.EXTENSION_USE_SYSTEM_PROFILE
    else process.env.EXTENSION_USE_SYSTEM_PROFILE = envBefore
    if (legacyEnvBefore === undefined) {
      delete process.env.EXTJS_USE_SYSTEM_PROFILE
    } else process.env.EXTJS_USE_SYSTEM_PROFILE = legacyEnvBefore

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

  const launchWith = async (host: Record<string, unknown>) => {
    const plugin = new FirefoxLaunchPlugin(
      {extension: '/ext', browser: 'firefox', ...host} as any,
      {logger: undefined} as any
    )

    return (plugin as any)
      .launch({options: {mode: 'development'}, errors: []}, {} as any)
      .then(
        () => null,
        (error: unknown) => error
      )
  }

  it.each([
    [{profile: false, profileSource: 'flag'}, {}, '--profile=false'],
    [
      {profile: false, profileSource: 'config'},
      {},
      'profile: false in extension.config.js'
    ],
    [
      {},
      {EXTENSION_USE_SYSTEM_PROFILE: 'true'},
      'EXTENSION_USE_SYSTEM_PROFILE=true'
    ],
    [{}, {EXTJS_USE_SYSTEM_PROFILE: 'true'}, 'EXTJS_USE_SYSTEM_PROFILE=true']
  ])('refuses before any spawn when %o with env %o, naming %s', async (host, env, named) => {
    Object.assign(process.env, env)

    const error = await launchWith(host)

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(error.message).toContain(
      "Firefox can't load the add-on in its own profile, so it was not launched."
    )

    expect(error.message).toContain(`SET BY ${named}`)
    expect(error.message).toContain('--profile=<path>')
  })

  it('names both settings when the flag and the env switch are on', async () => {
    process.env.EXTENSION_USE_SYSTEM_PROFILE = 'true'

    const error = await launchWith({profile: false, profileSource: 'flag'})

    expect(error.message).toContain(
      'SET BY --profile=false, EXTENSION_USE_SYSTEM_PROFILE=true'
    )

    expect(error.message).toContain(
      'drop --profile=false and unset EXTENSION_USE_SYSTEM_PROFILE'
    )
  })

  it('does not refuse a managed or explicit profile', async () => {
    expect(await launchWith({})).toBeNull()
    expect(await launchWith({profile: path.join(scratch, 'p')})).toBeNull()
    expect(
      await launchWith({profile: 'false-friend', profileSource: 'flag'})
    ).toBeNull()
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
