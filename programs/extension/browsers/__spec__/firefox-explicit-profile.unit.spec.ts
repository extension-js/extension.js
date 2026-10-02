import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {resolveFirefoxLaunchConfig} from '../run-firefox/firefox-launch/browser-config'
import {removeSessionPreferences} from '../run-firefox/firefox-launch/session-preferences'

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

  const REMOTE_DEBUGGING_LINES = [
    'user_pref("devtools.chrome.enabled", true);',
    'user_pref("devtools.debugger.prompt-connection", false);',
    'user_pref("devtools.debugger.remote-enabled", true);'
  ]

  function launchOn(profile: string) {
    return resolveFirefoxLaunchConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox',
      profile,
      preferences: {'ui.systemUsesDarkTheme': 1}
    } as any)
  }

  it('adds only the remote debugging prefs to a profile the developer owns', async () => {
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

    const launch = await launchOn(profile)

    expect(launch.profilePath).toBe(profile)

    const userJs = fs.readFileSync(path.join(profile, 'user.js'), 'utf8')
    expect(userJs.startsWith(OWN_USER_JS)).toBe(true)

    // Without these three the debugger server never listens and the add-on
    // install has nothing to connect to.
    for (const line of REMOTE_DEBUGGING_LINES) expect(userJs).toContain(line)

    expect(userJs.match(/user_pref\(/g)).toHaveLength(
      1 + REMOTE_DEBUGGING_LINES.length
    )

    expect(fs.readFileSync(path.join(profile, 'prefs.js'), 'utf8')).toBe(
      'user_pref("browser.startup.page", 3);\n'
    )

    expect(
      fs.existsSync(path.join(profile, 'startupCache', 'startupCache.8.little'))
    ).toBe(true)
  })

  it('hands the developer their user.js back byte for byte when the session ends', async () => {
    const profile = path.join(scratch, 'real-profile')
    const ownWithoutFinalNewline = 'user_pref("my.own.pref", true);'
    fs.mkdirSync(profile, {recursive: true})
    fs.writeFileSync(path.join(profile, 'user.js'), ownWithoutFinalNewline)

    // A relaunch over a block a crashed session left replaces it.
    await launchOn(profile)
    await launchOn(profile)

    const during = fs.readFileSync(path.join(profile, 'user.js'), 'utf8')
    expect(during.match(/devtools\.debugger\.remote-enabled/g)).toHaveLength(1)

    removeSessionPreferences(profile)

    expect(fs.readFileSync(path.join(profile, 'user.js'), 'utf8')).toBe(
      ownWithoutFinalNewline
    )
  })

  it('leaves no user.js behind in a profile that had none', async () => {
    const profile = path.join(scratch, 'prefs-only-profile')
    fs.mkdirSync(profile, {recursive: true})
    fs.writeFileSync(path.join(profile, 'prefs.js'), '// Mozilla\n')

    await launchOn(profile)

    const userJs = fs.readFileSync(path.join(profile, 'user.js'), 'utf8')
    for (const line of REMOTE_DEBUGGING_LINES) expect(userJs).toContain(line)

    removeSessionPreferences(profile)

    expect(fs.existsSync(path.join(profile, 'user.js'))).toBe(false)
  })

  it('says so when it switches remote debugging on in that profile', async () => {
    const profile = path.join(scratch, 'real-profile')
    fs.mkdirSync(profile, {recursive: true})
    fs.writeFileSync(path.join(profile, 'prefs.js'), '// Mozilla\n')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await launchOn(profile)

      const printed = log.mock.calls.map((call) => String(call[0])).join('\n')
      expect(printed).toMatch(/Remote debugging is switched on/)
      expect(printed).toContain(profile)
    } finally {
      log.mockRestore()
    }
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
