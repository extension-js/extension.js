import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {resolveFirefoxLaunchConfig} from '../run-firefox/firefox-launch/browser-config'

const OWN_USER_JS = 'user_pref("my.own.pref", true);\n'

describe('firefox explicit profile preferences', () => {
  let scratch: string

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fx-explicit-'))
  })

  afterEach(() => {
    fs.rmSync(scratch, {recursive: true, force: true})
  })

  function makeCompilation() {
    const project = path.join(scratch, 'project')

    return {
      options: {
        context: project,
        output: {path: path.join(project, 'dist', 'firefox')}
      }
    } as any
  }

  it('keeps the user.js, prefs and startupCache of a profile the developer owns', async () => {
    const profile = path.join(scratch, 'real-profile')
    fs.mkdirSync(path.join(profile, 'startupCache'), {recursive: true})
    fs.writeFileSync(
      path.join(profile, 'prefs.js'),
      'user_pref("browser.startup.page", 3);\n'
    )

    fs.writeFileSync(path.join(profile, 'user.js'), OWN_USER_JS)
    fs.writeFileSync(
      path.join(profile, 'startupCache', 'startupCache.8.little'),
      'cache'
    )

    const launch = await resolveFirefoxLaunchConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox',
      profile
    } as any)

    expect(launch.profilePath).toBe(profile)
    expect(fs.readFileSync(path.join(profile, 'user.js'), 'utf8')).toBe(
      OWN_USER_JS
    )

    expect(fs.readFileSync(path.join(profile, 'prefs.js'), 'utf8')).toContain(
      '"browser.startup.page", 3'
    )

    expect(
      fs.existsSync(path.join(profile, 'startupCache', 'startupCache.8.little'))
    ).toBe(true)
  })

  it('seeds an explicit directory that holds no profile yet', async () => {
    const profile = path.join(scratch, 'fresh-profile')

    const launch = await resolveFirefoxLaunchConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox',
      profile
    } as any)

    expect(launch.profilePath).toBe(profile)
    const userJs = fs.readFileSync(path.join(profile, 'user.js'), 'utf8')
    expect(userJs).toContain(
      'user_pref("xpinstall.signatures.required", false);'
    )

    expect(userJs).toContain(
      'user_pref("devtools.debugger.remote-enabled", true);'
    )
  })

  it('writes the full pref set into a managed profile and drops its startupCache', async () => {
    const compilation = makeCompilation()
    const managed = path.join(
      scratch,
      'project',
      'dist',
      'extension-js',
      'profiles',
      'firefox-profile',
      'dev'
    )
    fs.mkdirSync(path.join(managed, 'startupCache'), {recursive: true})
    fs.writeFileSync(path.join(managed, 'startupCache', 'stale.bin'), 'stale')
    fs.writeFileSync(path.join(managed, 'user.js'), OWN_USER_JS)

    const launch = await resolveFirefoxLaunchConfig(compilation, {
      extension: '/ext',
      browser: 'firefox',
      keepProfileChanges: true
    } as any)

    expect(launch.profilePath).toBe(managed)
    const userJs = fs.readFileSync(path.join(managed, 'user.js'), 'utf8')
    expect(userJs).not.toContain('my.own.pref')
    expect(userJs).toContain(
      'user_pref("xpinstall.signatures.required", false);'
    )

    expect(userJs).toContain(
      'user_pref("devtools.debugger.prompt-connection", false);'
    )

    expect(fs.existsSync(path.join(managed, 'startupCache'))).toBe(false)
  })
})
