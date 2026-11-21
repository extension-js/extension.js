import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildBrowserLaunchRequest} from '../../browsers-lib/runtime-options'
import type {FirefoxContext} from '../../run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from '../../run-firefox/firefox-launch'
import {resolveFirefoxLaunchConfig} from '../../run-firefox/firefox-launch/browser-config'
import type {FirefoxPluginRuntime} from '../../run-firefox/firefox-types'
import {type FakeFirefox, fakeFirefox} from '../fake-browser'

type LaunchConfigCompilation = Parameters<typeof resolveFirefoxLaunchConfig>[0]
type LaunchConfigHost = Parameters<typeof resolveFirefoxLaunchConfig>[1]
type RequestHost = Parameters<typeof buildBrowserLaunchRequest>[0]
type LaunchFailure = (Error & {code?: string}) | null

// The private members these rows drive, reached through one cast.
interface LaunchInternals {
  launch(compilation: unknown, request: unknown): Promise<void>
  reportReady(mode: 'development' | 'production'): void
}

function internals(plugin: FirefoxLaunchPlugin): LaunchInternals {
  return plugin as unknown as LaunchInternals
}

const noLoggerContext = () => ({logger: undefined}) as FirefoxContext

describe('firefox on its own profile', () => {
  let scratch: string
  let fake: FakeFirefox

  // The fake clears both system-profile switches and restores them on close.
  beforeEach(async () => {
    fake = await fakeFirefox()
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fx-system-'))
  })

  afterEach(async () => {
    fs.rmSync(scratch, {recursive: true, force: true})
    await fake.close()
    vi.restoreAllMocks()
  })

  it('resolves no profile path, so there is nothing to install the add-on into', async () => {
    vi.stubEnv('EXTENSION_USE_SYSTEM_PROFILE', 'true')
    const project = path.join(scratch, 'project')
    const launch = await resolveFirefoxLaunchConfig(
      {
        options: {
          context: project,
          output: {path: path.join(project, 'dist', 'firefox')}
        }
      } as LaunchConfigCompilation,
      {
        extension: '/ext',
        browser: 'firefox',
        profile: false
      } as LaunchConfigHost
    )

    expect(launch.profilePath).toBeFalsy()
  })

  // The request is built off the host, the way every production caller does.
  const launchWith = async (
    options: Record<string, unknown>
  ): Promise<LaunchFailure> => {
    const host = {extension: fake.project.out, browser: 'firefox', ...options}
    const plugin = new FirefoxLaunchPlugin(
      host as FirefoxPluginRuntime,
      noLoggerContext(),
      fake.deps
    )

    return internals(plugin)
      .launch(
        fake.project.compilation('development'),
        buildBrowserLaunchRequest(host as RequestHost, 'development')
      )
      .then(
        () => null,
        (error: unknown) => error as LaunchFailure
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
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)

    const error = await launchWith(host)

    expect(error).toBeInstanceOf(Error)
    expect(error?.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(error?.message).toContain(
      "Firefox can't load the add-on in its own profile, so it was not launched."
    )

    expect(error?.message).toContain(`SET BY ${named}`)
    expect(error?.message).toContain('--profile=<path>')
    expect(fake.spawns).toEqual([])
    expect(fake.claims).toEqual([])
  })

  it('names both settings when the flag and the env switch are on', async () => {
    vi.stubEnv('EXTENSION_USE_SYSTEM_PROFILE', 'true')

    const error = await launchWith({profile: false, profileSource: 'flag'})

    expect(error?.message).toContain(
      'SET BY --profile=false, EXTENSION_USE_SYSTEM_PROFILE=true'
    )

    expect(error?.message).toContain(
      'drop --profile=false and unset EXTENSION_USE_SYSTEM_PROFILE'
    )
  })

  // A dry run, so a relative profile name is planned and never created. The
  // plan naming the profile proves the check let the launch through.
  it.each([
    ['the managed profile', {}, 'firefox-profile'],
    ['an explicit profile', {profile: 'explicit-profile'}, 'explicit-profile'],
    [
      'a profile whose name starts with false',
      {profile: 'false-friend', profileSource: 'flag'},
      'false-friend'
    ]
  ])('lets a launch on %s through to the browser', async (_label, host, named) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const binary = fake.project.plantBinary()

    expect(
      await launchWith({...host, geckoBinary: binary, dryRun: true})
    ).toBeNull()

    const args =
      log.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes('ARGS')) || ''

    expect(args).toMatch(new RegExp(`-profile \\S*${named}`))
    expect(fake.probed).toEqual([binary])
    expect(fake.spawns).toEqual([])
  })

  it('still prints the ready line when the add-on was installed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const plugin = new FirefoxLaunchPlugin(
      {browser: 'firefox'} as FirefoxPluginRuntime,
      noLoggerContext()
    )
    internals(plugin).reportReady('development')

    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(
      /ready for development/
    )
  })
})
