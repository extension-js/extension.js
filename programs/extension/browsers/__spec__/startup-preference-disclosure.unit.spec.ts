import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {devAdditionsNote} from '../browsers-lib/messages'
import {
  readReadyDevAdditions,
  readyPathFor,
  stampReadyDevBrowserFlag,
  stampReadyDevBrowserPreference
} from '../browsers-lib/ready-stamp'
import {
  startupPreferenceIsDue,
  startupPreferenceReport,
  startupPreferenceUnavailable
} from '../run-chromium/cdp/ensure-startup-new-tab'

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')
const VALUE = 'session.restore_on_startup=5'
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function tempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)

  return dir
}

// A profile as the launch leaves it before the browser starts: the seed in
// Preferences, and whatever the browser itself holds in Secure Preferences.
function profile(options: {seed?: number; held?: number; ephemeral?: boolean}) {
  const dir = tempDir('extjs-startup-pref-')
  fs.mkdirSync(path.join(dir, 'Default'), {recursive: true})

  if (options.seed !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'Default', 'Preferences'),
      JSON.stringify({session: {restore_on_startup: options.seed}})
    )
  }

  if (options.held !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'Default', 'Secure Preferences'),
      JSON.stringify({session: {restore_on_startup: options.held}})
    )
  }

  if (options.ephemeral) {
    fs.writeFileSync(path.join(dir, '.extension-js-managed-profile'), '')
  }

  return [`--user-data-dir=${dir}`, '--remote-debugging-pipe']
}

function session(ready: Record<string, unknown>) {
  const outPath = path.join(tempDir('extjs-startup-ready-'), 'dist', 'chrome')
  fs.mkdirSync(outPath, {recursive: true})

  const readyPath = readyPathFor(outPath)
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(readyPath, JSON.stringify(ready))

  return {
    outPath,
    read: () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
  }
}

describe('what a session says about the startup preference it writes', () => {
  // The write outlives the session, so the person is told before it lands.
  it('names the preference, why, and how to keep the session off it', () => {
    const report = startupPreferenceReport(profile({seed: 5}))

    expect(report).toMatchObject({
      kind: 'browser_preference',
      value: VALUE,
      applied: true,
      cause: 'default'
    })

    expect(report?.reason).toContain('stays in the profile')
    expect(report?.change).toContain('preferences in extension.config.js')
    expect(report?.change).toContain('chrome://settings')
  })

  it('says the same of a profile an earlier session already wrote', () => {
    expect(startupPreferenceReport(profile({seed: 5, held: 5}))).toMatchObject({
      value: VALUE,
      applied: true,
      cause: 'default'
    })
  })

  // The opt-out: the project's own preferences name the setting.
  it('leaves it alone, and says so, when preferences sets another value', () => {
    const args = profile({seed: 1})
    const report = startupPreferenceReport(args)

    expect(report).toMatchObject({
      kind: 'browser_preference',
      value: VALUE,
      applied: false,
      cause: 'preferences'
    })

    expect(report?.reason).toContain('preferences in extension.config.js')
    expect(report?.change).toContain('remove session.restore_on_startup')
    expect(startupPreferenceIsDue(args)).toBe(false)
  })

  // Nothing persists there, or nothing was ever seeded there.
  it('says nothing where the session writes nothing', () => {
    expect(
      startupPreferenceReport(profile({seed: 5, ephemeral: true}))
    ).toBeUndefined()

    expect(startupPreferenceReport(profile({}))).toBeUndefined()
    expect(startupPreferenceReport(['--remote-debugging-pipe'])).toBeUndefined()
    expect(
      startupPreferenceReport([...profile({seed: 5}), '--no-startup-window'])
    ).toBeUndefined()
  })

  it('has the write to make only while the browser holds no value', () => {
    expect(startupPreferenceIsDue(profile({seed: 5}))).toBe(true)
    expect(startupPreferenceIsDue(profile({seed: 5, held: 5}))).toBe(false)
    expect(startupPreferenceIsDue(profile({seed: 5, held: 1}))).toBe(false)
    expect(startupPreferenceIsDue(profile({seed: 5, ephemeral: true}))).toBe(
      false
    )

    expect(startupPreferenceIsDue(['--remote-debugging-pipe'])).toBe(false)
  })
})

describe('the startup preference in the ready contract', () => {
  it('lands under devAdditions beside what is already there', () => {
    const {outPath, read} = session({
      runId: 'run-1',
      devAdditions: [{kind: 'permission', value: 'scripting', reason: 'r'}]
    })

    stampReadyDevBrowserFlag(
      outPath,
      {kind: 'browser_flag', value: '--some-flag', applied: true},
      'run-1'
    )

    stampReadyDevBrowserPreference(
      outPath,
      startupPreferenceReport(profile({seed: 5})) as never,
      'run-1'
    )

    expect(read().devAdditions).toEqual([
      {kind: 'permission', value: 'scripting', reason: 'r'},
      {kind: 'browser_flag', value: '--some-flag', applied: true},
      expect.objectContaining({
        kind: 'browser_preference',
        value: VALUE,
        applied: true,
        cause: 'default',
        reason: expect.any(String),
        change: expect.any(String)
      })
    ])
  })

  // The card said the write was coming, and the browser refused it.
  it('is replaced, not repeated, when the browser did not take the write', () => {
    const {outPath} = session({runId: 'run-1'})

    stampReadyDevBrowserPreference(
      outPath,
      startupPreferenceReport(profile({seed: 5})) as never,
      'run-1'
    )

    stampReadyDevBrowserPreference(
      outPath,
      startupPreferenceUnavailable(),
      'run-1'
    )

    const entries = readReadyDevAdditions(outPath)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'browser_preference',
      value: VALUE,
      applied: false,
      cause: 'unavailable'
    })
  })

  it('never writes into the contract of another run', () => {
    const {outPath, read} = session({runId: 'run-1'})

    stampReadyDevBrowserPreference(
      outPath,
      startupPreferenceUnavailable(),
      'run-2'
    )

    expect(read().devAdditions).toBeUndefined()
  })
})

describe('the startup preference on the card', () => {
  const line = (entry: {applied: boolean; cause?: string}) =>
    plain(
      devAdditionsNote([{kind: 'browser_preference', value: VALUE, ...entry}])
    )

  it('says the write stays in the profile and what changes it', () => {
    expect(line({applied: true, cause: 'default'})).toBe(
      `    Dev pref       ${VALUE} written to this kept profile and stays there, preferences changes it`
    )
  })

  it('says when the project opted out or the browser refused', () => {
    expect(line({applied: false, cause: 'preferences'})).toBe(
      `    Dev pref       ${VALUE} left to the browser, preferences sets it`
    )

    expect(line({applied: false, cause: 'unavailable'})).toBe(
      `    Dev pref       ${VALUE} not written, the browser did not take it`
    )
  })
})
