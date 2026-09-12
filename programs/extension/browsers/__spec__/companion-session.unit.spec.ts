import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  COMPANION_SESSION_FLAGS_FILE,
  isDevtoolsCompanionPath,
  stageCompanionForNoOpen,
  stagedCompanionPath
} from '../browsers-lib/companion-session'
import {browserConfig} from '../run-chromium/chromium-launch/browser-config'
import {resolveFirefoxLaunchConfig} from '../run-firefox/firefox-launch/browser-config'

let root: string
let companion: string
let user: string
let profile: string

function writeCompanion(dir: string) {
  fs.mkdirSync(path.join(dir, 'background'), {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({name: 'Extension.js', manifest_version: 3})
  )
  fs.writeFileSync(path.join(dir, 'background', 'sw.js'), '// sw')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-companion-session-'))
  companion = path.join(root, 'extension-js-devtools', 'dist', 'chromium')
  user = path.join(root, 'project', 'dist', 'chromium')
  profile = path.join(root, 'profiles', 'chromium-profile', 'quiet-fox')
  writeCompanion(companion)
  fs.mkdirSync(user, {recursive: true})
  fs.writeFileSync(path.join(user, 'manifest.json'), '{}')
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('isDevtoolsCompanionPath', () => {
  it('recognizes the shared dist and a staged copy, and nothing else', () => {
    expect(isDevtoolsCompanionPath(companion)).toBe(true)
    expect(
      isDevtoolsCompanionPath(stagedCompanionPath(profile, companion))
    ).toBe(true)
    expect(isDevtoolsCompanionPath(user)).toBe(false)
    expect(isDevtoolsCompanionPath('/x/extension-js-theme/dist/chrome')).toBe(
      false
    )
  })
})

describe('stageCompanionForNoOpen', () => {
  it('leaves the list alone without --no-open', () => {
    const list = [companion, user]
    expect(
      stageCompanionForNoOpen({
        extensionPaths: list,
        noOpen: false,
        stageRoot: profile
      })
    ).toBe(list)
    expect(fs.existsSync(path.join(profile, 'extension-js-devtools'))).toBe(
      false
    )
  })

  it('leaves the list alone when the session has no profile dir to own', () => {
    const list = [companion, user]
    expect(
      stageCompanionForNoOpen({
        extensionPaths: list,
        noOpen: true,
        stageRoot: ''
      })
    ).toBe(list)
  })

  it('leaves the list alone when no companion is loaded', () => {
    const list = [user]
    expect(
      stageCompanionForNoOpen({
        extensionPaths: list,
        noOpen: true,
        stageRoot: profile
      })
    ).toBe(list)
  })

  it('copies the companion into the profile with the flag file and swaps the path in place', () => {
    const theme = path.join(root, 'extension-js-theme', 'dist', 'chromium')
    const next = stageCompanionForNoOpen({
      extensionPaths: [companion, theme, user],
      noOpen: true,
      stageRoot: profile
    })

    const staged = stagedCompanionPath(profile, companion)
    expect(next).toEqual([staged, theme, user])
    expect(staged).toBe(path.join(profile, 'extension-js-devtools', 'chromium'))
    expect(fs.existsSync(path.join(staged, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(staged, 'background', 'sw.js'))).toBe(true)
    expect(
      JSON.parse(
        fs.readFileSync(path.join(staged, COMPANION_SESSION_FLAGS_FILE), 'utf8')
      )
    ).toEqual({noOpen: true})
    // The shared dist never carries the flag.
    expect(
      fs.existsSync(path.join(companion, COMPANION_SESSION_FLAGS_FILE))
    ).toBe(false)
  })

  it('refreshes a stale copy on the next launch', () => {
    const staged = stagedCompanionPath(profile, companion)
    fs.mkdirSync(staged, {recursive: true})
    fs.writeFileSync(path.join(staged, 'stale.js'), '// old')

    stageCompanionForNoOpen({
      extensionPaths: [companion, user],
      noOpen: true,
      stageRoot: profile
    })

    expect(fs.existsSync(path.join(staged, 'stale.js'))).toBe(false)
    expect(fs.existsSync(path.join(staged, 'manifest.json'))).toBe(true)
  })

  it('only computes the path when provisioning is off (dry run)', () => {
    const next = stageCompanionForNoOpen({
      extensionPaths: [companion, user],
      noOpen: true,
      stageRoot: profile,
      provision: false
    })
    expect(next[0]).toBe(stagedCompanionPath(profile, companion))
    expect(fs.existsSync(profile)).toBe(false)
  })

  it('does not re-stage a list that already points at the staged copy', () => {
    const staged = stageCompanionForNoOpen({
      extensionPaths: [companion, user],
      noOpen: true,
      stageRoot: profile
    })
    const again = stageCompanionForNoOpen({
      extensionPaths: staged,
      noOpen: true,
      stageRoot: profile
    })
    expect(again).toBe(staged)
    expect(fs.existsSync(path.join(staged[0], 'manifest.json'))).toBe(true)
  })

  it('falls back to the shared dist when the copy cannot be made', () => {
    const list = [
      path.join(root, 'extension-js-devtools', 'dist', 'missing'),
      user
    ]
    expect(
      stageCompanionForNoOpen({
        extensionPaths: list,
        noOpen: true,
        stageRoot: profile
      })
    ).toBe(list)
  })
})

describe('the launch configs load the staged companion under --no-open', () => {
  it('chromium points --load-extension at the copy inside the profile', () => {
    const args = browserConfig(
      {
        options: {mode: 'development', context: root, output: {path: user}}
      } as any,
      {
        extension: [companion, user],
        browser: 'chromium',
        profile,
        noOpen: true
      } as any,
      {provision: false}
    )
    const flag = args.find((a) => a.startsWith('--load-extension='))
    expect(flag).toBe(
      `--load-extension=${[stagedCompanionPath(profile, companion), user].join()}`
    )
  })

  it('chromium keeps the shared dist without --no-open', () => {
    const args = browserConfig(
      {
        options: {mode: 'development', context: root, output: {path: user}}
      } as any,
      {extension: [companion, user], browser: 'chromium', profile} as any,
      {provision: false}
    )
    const flag = args.find((a) => a.startsWith('--load-extension='))
    expect(flag).toBe(`--load-extension=${[companion, user].join()}`)
  })

  it('firefox hands the RDP install the copy inside the profile', async () => {
    const firefoxProfile = path.join(root, 'profiles', 'firefox-profile', 'dev')
    const config = await resolveFirefoxLaunchConfig(
      {
        options: {mode: 'development', context: root, output: {path: user}}
      } as any,
      {
        extension: [companion, user],
        browser: 'firefox',
        profile: firefoxProfile,
        noOpen: true,
        mode: 'development'
      } as any,
      {provision: false}
    )
    expect(config.profilePath).toBe(firefoxProfile)
    expect(config.extensionsToLoad).toEqual([
      stagedCompanionPath(firefoxProfile, companion),
      user
    ])
  })

  it('firefox keeps the shared dist without --no-open', async () => {
    const config = await resolveFirefoxLaunchConfig(
      {
        options: {mode: 'development', context: root, output: {path: user}}
      } as any,
      {
        extension: [companion, user],
        browser: 'firefox',
        profile: path.join(root, 'profiles', 'firefox-profile', 'dev'),
        mode: 'development'
      } as any,
      {provision: false}
    )
    expect(config.extensionsToLoad).toEqual([companion, user])
  })
})
