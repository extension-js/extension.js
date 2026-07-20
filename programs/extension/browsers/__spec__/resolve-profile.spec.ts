import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {browserConfig as chromiumConfig} from '../run-chromium/chromium-launch/browser-config'
import {browserConfig as firefoxConfig} from '../run-firefox/firefox-launch/browser-config'

// ─────────────────────────────────────────────────────────────────────────────
// Profile-options contract, exercised end-to-end through BOTH launchers.
//
// Locks the behaviour of the shared resolve-profile decision via on-disk
// assertions only (no real browser, no network):
//   - profile: false           → browser's own default profile, no managed dir
//   - explicit path            → launched against exactly that directory
//   - nothing                  → fresh managed throwaway profile
//   - empty / whitespace path  → behaves like nothing, NOT like false
//   - copyFromProfile          → managed profile seeded as a copy of the source
//   - keepProfileChanges       → managed profile + changes survive a 2nd run
// ─────────────────────────────────────────────────────────────────────────────

let SCRATCH: string

function distFor(browser: 'chrome' | 'firefox') {
  return path.join(SCRATCH, 'project', 'dist', browser)
}

function makeCompilation(out: string) {
  return {options: {output: {path: out}}} as any
}

/** Chromium: the directory the launch points at, or null if no --user-data-dir. */
function chromiumUserDataDir(flags: string[]): string | null {
  const flag = flags.find((f) => f.startsWith('--user-data-dir='))
  return flag ? flag.replace('--user-data-dir=', '') : null
}

/** Firefox: the directory the launch points at, or null if no --profile. */
function firefoxProfileDir(args: string): string | null {
  const m = args.match(/--profile="([^"]+)"/)
  return m ? m[1] : null
}

const MANAGED_MARKER = '.extension-js-managed-profile'

describe('profile-options contract (both launchers)', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = {...OLD_ENV}
    delete process.env.EXTENSION_USE_SYSTEM_PROFILE
    delete process.env.EXTJS_USE_SYSTEM_PROFILE
    SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-contract-'))
  })

  afterEach(() => {
    process.env = OLD_ENV
    try {
      fs.rmSync(SCRATCH, {recursive: true, force: true})
    } catch {}
  })

  // ── profile: false → the browser's own default profile ──────────────────────

  it('chromium: profile false uses the default profile, no managed dir, no --user-data-dir', () => {
    const out = distFor('chrome')
    const flags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      profile: false
    } as any)

    expect(chromiumUserDataDir(flags)).toBeNull()
    const profilesRoot = path.join(
      path.dirname(out),
      'extension-js',
      'profiles'
    )
    expect(fs.existsSync(profilesRoot)).toBe(false)
  })

  it('firefox: profile false uses the default profile, no managed dir, no --profile', async () => {
    const out = distFor('firefox')
    const args = await firefoxConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'firefox',
      profile: false
    } as any)

    expect(firefoxProfileDir(args)).toBeNull()
    const profilesRoot = path.join(
      path.dirname(out),
      'extension-js',
      'profiles'
    )
    expect(fs.existsSync(profilesRoot)).toBe(false)
  })

  it('profile false matches the EXTENSION_USE_SYSTEM_PROFILE env switch (chromium)', () => {
    const out = distFor('chrome')
    process.env.EXTENSION_USE_SYSTEM_PROFILE = 'true'
    const envFlags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    delete process.env.EXTENSION_USE_SYSTEM_PROFILE
    const falseFlags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      profile: false
    } as any)

    expect(chromiumUserDataDir(envFlags)).toBeNull()
    expect(chromiumUserDataDir(falseFlags)).toBeNull()
  })

  // ── explicit path → launched against exactly that directory ─────────────────

  it('chromium: explicit profile path launches against exactly that directory', () => {
    const explicit = fs.mkdtempSync(path.join(SCRATCH, 'explicit-chrome-'))
    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      profile: explicit
    } as any)
    expect(chromiumUserDataDir(flags)).toBe(explicit)
  })

  it('firefox: explicit profile path launches against exactly that directory', async () => {
    const explicit = fs.mkdtempSync(path.join(SCRATCH, 'explicit-fx-'))
    const args = await firefoxConfig(makeCompilation(distFor('firefox')), {
      extension: '/ext',
      browser: 'firefox',
      profile: explicit
    } as any)
    expect(firefoxProfileDir(args)).toBe(explicit)
  })

  // ── nothing → fresh managed throwaway profile ───────────────────────────────

  it('chromium: nothing gives a managed throwaway profile (marked for cleanup)', () => {
    const out = distFor('chrome')
    const flags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    const dir = chromiumUserDataDir(flags)
    expect(dir).toBeTruthy()
    expect(dir).toContain(
      path.join('extension-js', 'profiles', 'chrome-profile')
    )
    // throwaway → carries the managed-ephemeral marker (cleaned on exit)
    expect(fs.existsSync(path.join(String(dir), MANAGED_MARKER))).toBe(true)
  })

  it('firefox: nothing gives a managed throwaway profile (marked for cleanup)', async () => {
    const out = distFor('firefox')
    const args = await firefoxConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'firefox'
    } as any)
    const dir = firefoxProfileDir(args)
    expect(dir).toBeTruthy()
    expect(dir).toContain(
      path.join('extension-js', 'profiles', 'firefox-profile')
    )
    expect(fs.existsSync(path.join(String(dir), MANAGED_MARKER))).toBe(true)
  })

  // ── empty / whitespace string → like nothing, NOT like false ────────────────

  it('chromium: empty string is NOT false, a managed profile is still created', () => {
    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      profile: ''
    } as any)
    expect(chromiumUserDataDir(flags)).toBeTruthy()
  })

  it('chromium: whitespace-only string is NOT false, a managed profile is still created', () => {
    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      profile: '   '
    } as any)
    expect(chromiumUserDataDir(flags)).toBeTruthy()
  })

  it('firefox: empty string is NOT false, a managed profile is still created', async () => {
    const args = await firefoxConfig(makeCompilation(distFor('firefox')), {
      extension: '/ext',
      browser: 'firefox',
      profile: ''
    } as any)
    expect(firefoxProfileDir(args)).toBeTruthy()
  })

  // ── copyFromProfile → managed profile seeded as a copy of the source ────────

  it('chromium: copyFromProfile seeds the managed profile with the source contents', () => {
    const source = fs.mkdtempSync(path.join(SCRATCH, 'src-chrome-'))
    fs.writeFileSync(path.join(source, 'marker.txt'), 'hello from source')
    fs.mkdirSync(path.join(source, 'sub'), {recursive: true})
    fs.writeFileSync(path.join(source, 'sub', 'nested.txt'), 'nested')

    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      copyFromProfile: source
    } as any)

    const dir = String(chromiumUserDataDir(flags))
    expect(fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8')).toBe(
      'hello from source'
    )
    expect(fs.readFileSync(path.join(dir, 'sub', 'nested.txt'), 'utf8')).toBe(
      'nested'
    )
  })

  it('firefox: copyFromProfile seeds the managed profile with the source contents', async () => {
    const source = fs.mkdtempSync(path.join(SCRATCH, 'src-fx-'))
    fs.writeFileSync(path.join(source, 'marker.txt'), 'firefox seed')

    const args = await firefoxConfig(makeCompilation(distFor('firefox')), {
      extension: '/ext',
      browser: 'firefox',
      copyFromProfile: source
    } as any)

    const dir = String(firefoxProfileDir(args))
    expect(fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8')).toBe(
      'firefox seed'
    )
  })

  // ── keepProfileChanges → managed profile + changes survive a 2nd run ────────

  it('chromium: keepProfileChanges keeps the managed dir and its changes across runs', () => {
    const out = distFor('chrome')
    const run1 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true
    } as any)
    const dir1 = String(chromiumUserDataDir(run1))

    // kept profiles are NOT marked for cleanup → removeManagedEphemeralProfile skips them
    expect(fs.existsSync(path.join(dir1, MANAGED_MARKER))).toBe(false)

    // user change made in the profile during the first run
    fs.writeFileSync(path.join(dir1, 'my-change.txt'), 'survives')

    const run2 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true
    } as any)
    const dir2 = String(chromiumUserDataDir(run2))

    expect(dir2).toBe(dir1) // stable directory across runs
    expect(fs.readFileSync(path.join(dir2, 'my-change.txt'), 'utf8')).toBe(
      'survives'
    )
  })

  it('firefox: keepProfileChanges keeps the managed dir and its changes across runs', async () => {
    const out = distFor('firefox')
    const run1 = await firefoxConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'firefox',
      keepProfileChanges: true
    } as any)
    const dir1 = String(firefoxProfileDir(run1))

    expect(fs.existsSync(path.join(dir1, MANAGED_MARKER))).toBe(false)
    fs.writeFileSync(path.join(dir1, 'my-change.txt'), 'survives')

    const run2 = await firefoxConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'firefox',
      keepProfileChanges: true
    } as any)
    const dir2 = String(firefoxProfileDir(run2))

    expect(dir2).toBe(dir1)
    expect(fs.readFileSync(path.join(dir2, 'my-change.txt'), 'utf8')).toBe(
      'survives'
    )
  })

  // ── copyFromProfile is copy-once when the profile is kept ────────────────────

  it('chromium: copyFromProfile + keepProfileChanges seeds once and does not clobber kept edits', () => {
    const out = distFor('chrome')
    const source = fs.mkdtempSync(path.join(SCRATCH, 'src-once-chrome-'))
    fs.writeFileSync(path.join(source, 'seeded.txt'), 'v1-from-source')

    const run1 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true,
      copyFromProfile: source
    } as any)
    const dir1 = String(chromiumUserDataDir(run1))
    // first run seeds from the source
    expect(fs.readFileSync(path.join(dir1, 'seeded.txt'), 'utf8')).toBe(
      'v1-from-source'
    )

    // user edits the seeded file and adds a profile-only file
    fs.writeFileSync(path.join(dir1, 'seeded.txt'), 'user-edited')
    fs.writeFileSync(path.join(dir1, 'user-only.txt'), 'keep')

    const run2 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true,
      copyFromProfile: source
    } as any)
    const dir2 = String(chromiumUserDataDir(run2))

    expect(dir2).toBe(dir1)
    // copy-once: the second run must NOT re-seed, so the edited seeded file and
    // the profile-only file both survive.
    expect(fs.readFileSync(path.join(dir2, 'seeded.txt'), 'utf8')).toBe(
      'user-edited'
    )
    expect(fs.readFileSync(path.join(dir2, 'user-only.txt'), 'utf8')).toBe(
      'keep'
    )
  })

  it('firefox: copyFromProfile + keepProfileChanges seeds once and does not clobber kept edits', async () => {
    const out = distFor('firefox')
    const source = fs.mkdtempSync(path.join(SCRATCH, 'src-once-fx-'))
    fs.writeFileSync(path.join(source, 'seeded.txt'), 'v1-from-source')

    const run1 = await firefoxConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'firefox',
      keepProfileChanges: true,
      copyFromProfile: source
    } as any)
    const dir1 = String(firefoxProfileDir(run1))
    expect(fs.readFileSync(path.join(dir1, 'seeded.txt'), 'utf8')).toBe(
      'v1-from-source'
    )

    fs.writeFileSync(path.join(dir1, 'seeded.txt'), 'user-edited')

    const run2 = await firefoxConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'firefox',
      keepProfileChanges: true,
      copyFromProfile: source
    } as any)
    const dir2 = String(firefoxProfileDir(run2))

    expect(dir2).toBe(dir1)
    expect(fs.readFileSync(path.join(dir2, 'seeded.txt'), 'utf8')).toBe(
      'user-edited'
    )
  })
})

describe('session-root ignore guard (§73 E22)', () => {
  let scratch: string

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-e22-guard-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(scratch, {recursive: true, force: true})
    } catch {}
  })

  function ignoreFileFor(out: string) {
    return path.join(path.dirname(out), 'extension-js', '.gitignore')
  }

  it('a managed profile launch drops a self-ignoring .gitignore in the session root', () => {
    const out = path.join(scratch, 'project', 'dist', 'chrome')
    chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome'
    } as any)

    const content = fs.readFileSync(ignoreFileFor(out), 'utf8')
    expect(content).toContain('*')
    expect(content).toContain('never be committed')
  })

  it('respects an existing (user-edited) ignore file', () => {
    const out = path.join(scratch, 'project', 'dist', 'chrome')
    const ignoreFile = ignoreFileFor(out)
    fs.mkdirSync(path.dirname(ignoreFile), {recursive: true})
    fs.writeFileSync(ignoreFile, 'profiles/\n')

    chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome'
    } as any)

    expect(fs.readFileSync(ignoreFile, 'utf8')).toBe('profiles/\n')
  })

  it('an explicit profile writes nothing under dist', () => {
    const out = path.join(scratch, 'project', 'dist', 'chrome')
    const explicit = path.join(scratch, 'my-profile')
    fs.mkdirSync(explicit, {recursive: true})
    chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      profile: explicit
    } as any)

    expect(fs.existsSync(ignoreFileFor(out))).toBe(false)
  })
})
