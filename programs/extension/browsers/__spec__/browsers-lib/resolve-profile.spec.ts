import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  normalizeProfileOption,
  resolveProfileConfig
} from '../../browsers-lib/resolve-profile'
import type {CompilationLike} from '../../browsers-types'
import {browserConfig as chromiumConfig} from '../../run-chromium/chromium-launch/browser-config'
import {browserConfig as firefoxConfig} from '../../run-firefox/firefox-launch/browser-config'

let SCRATCH: string

function distFor(browser: 'chrome' | 'firefox') {
  return path.join(SCRATCH, 'project', 'dist', browser)
}

type FirefoxOptions = Parameters<typeof firefoxConfig>[1]

// The launcher reads only the fields a row names, so the rest stay unset.
function firefoxOptions(options: Partial<FirefoxOptions>): FirefoxOptions {
  return options as FirefoxOptions
}

function makeCompilation(out: string): CompilationLike {
  return {options: {output: {path: out}}}
}

function chromiumUserDataDir(flags: string[]): string | null {
  const flag = flags.find((f) => f.startsWith('--user-data-dir='))

  return flag ? flag.replace('--user-data-dir=', '') : null
}

function firefoxProfileDir(args: string): string | null {
  const m = args.match(/--profile="([^"]+)"/)

  return m ? m[1] : null
}

const MANAGED_MARKER = '.extension-js-managed-profile'

describe('profile-options contract (both launchers)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('EXTENSION_USE_SYSTEM_PROFILE', undefined)
    vi.stubEnv('EXTJS_USE_SYSTEM_PROFILE', undefined)
    SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-contract-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()

    try {
      fs.rmSync(SCRATCH, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  it('chromium: profile false uses the default profile, no managed dir, no --user-data-dir', () => {
    const out = distFor('chrome')
    const flags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      profile: false
    })

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
    const args = await firefoxConfig(
      makeCompilation(out),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        profile: false
      })
    )

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
    vi.stubEnv('EXTENSION_USE_SYSTEM_PROFILE', 'true')
    const envFlags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome'
    })
    vi.stubEnv('EXTENSION_USE_SYSTEM_PROFILE', undefined)
    const falseFlags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      profile: false
    })

    expect(chromiumUserDataDir(envFlags)).toBeNull()
    expect(chromiumUserDataDir(falseFlags)).toBeNull()
  })

  it('chromium: explicit profile path launches against exactly that directory', () => {
    const explicit = fs.mkdtempSync(path.join(SCRATCH, 'explicit-chrome-'))
    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      profile: explicit
    })
    expect(chromiumUserDataDir(flags)).toBe(explicit)
  })

  it('firefox: explicit profile path launches against exactly that directory', async () => {
    const explicit = fs.mkdtempSync(path.join(SCRATCH, 'explicit-fx-'))
    const args = await firefoxConfig(
      makeCompilation(distFor('firefox')),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        profile: explicit
      })
    )
    expect(firefoxProfileDir(args)).toBe(explicit)
  })

  it('chromium: nothing gives a managed throwaway profile (marked for cleanup)', () => {
    const out = distFor('chrome')
    const flags = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome'
    })
    const dir = chromiumUserDataDir(flags)
    expect(dir).toBeTruthy()
    expect(dir).toContain(
      path.join('extension-js', 'profiles', 'chrome-profile')
    )

    expect(fs.existsSync(path.join(String(dir), MANAGED_MARKER))).toBe(true)
  })

  it('firefox: nothing gives a managed throwaway profile (marked for cleanup)', async () => {
    const out = distFor('firefox')
    const args = await firefoxConfig(
      makeCompilation(out),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox'
      })
    )
    const dir = firefoxProfileDir(args)
    expect(dir).toBeTruthy()
    expect(dir).toContain(
      path.join('extension-js', 'profiles', 'firefox-profile')
    )

    expect(fs.existsSync(path.join(String(dir), MANAGED_MARKER))).toBe(true)
  })

  it('chromium: empty string is NOT false, a managed profile is still created', () => {
    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      profile: ''
    })
    expect(chromiumUserDataDir(flags)).toBeTruthy()
  })

  it('chromium: whitespace-only string is NOT false, a managed profile is still created', () => {
    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      profile: '   '
    })
    expect(chromiumUserDataDir(flags)).toBeTruthy()
  })

  it('firefox: empty string is NOT false, a managed profile is still created', async () => {
    const args = await firefoxConfig(
      makeCompilation(distFor('firefox')),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        profile: ''
      })
    )
    expect(firefoxProfileDir(args)).toBeTruthy()
  })

  it('chromium: copyFromProfile seeds the managed profile with the source contents', () => {
    const source = fs.mkdtempSync(path.join(SCRATCH, 'src-chrome-'))
    fs.writeFileSync(path.join(source, 'marker.txt'), 'hello from source')
    fs.mkdirSync(path.join(source, 'sub'), {recursive: true})
    fs.writeFileSync(path.join(source, 'sub', 'nested.txt'), 'nested')

    const flags = chromiumConfig(makeCompilation(distFor('chrome')), {
      extension: '/ext',
      browser: 'chrome',
      copyFromProfile: source
    })

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

    const args = await firefoxConfig(
      makeCompilation(distFor('firefox')),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        copyFromProfile: source
      })
    )

    const dir = String(firefoxProfileDir(args))
    expect(fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8')).toBe(
      'firefox seed'
    )
  })

  it('chromium: keepProfileChanges keeps the managed dir and its changes across runs', () => {
    const out = distFor('chrome')
    const run1 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true
    })
    const dir1 = String(chromiumUserDataDir(run1))

    expect(fs.existsSync(path.join(dir1, MANAGED_MARKER))).toBe(false)

    fs.writeFileSync(path.join(dir1, 'my-change.txt'), 'survives')

    const run2 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true
    })
    const dir2 = String(chromiumUserDataDir(run2))

    expect(dir2).toBe(dir1)
    expect(fs.readFileSync(path.join(dir2, 'my-change.txt'), 'utf8')).toBe(
      'survives'
    )
  })

  it('firefox: keepProfileChanges keeps the managed dir and its changes across runs', async () => {
    const out = distFor('firefox')
    const run1 = await firefoxConfig(
      makeCompilation(out),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        keepProfileChanges: true
      })
    )
    const dir1 = String(firefoxProfileDir(run1))

    expect(fs.existsSync(path.join(dir1, MANAGED_MARKER))).toBe(false)
    fs.writeFileSync(path.join(dir1, 'my-change.txt'), 'survives')

    const run2 = await firefoxConfig(
      makeCompilation(out),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        keepProfileChanges: true
      })
    )
    const dir2 = String(firefoxProfileDir(run2))

    expect(dir2).toBe(dir1)
    expect(fs.readFileSync(path.join(dir2, 'my-change.txt'), 'utf8')).toBe(
      'survives'
    )
  })

  it('chromium: copyFromProfile + keepProfileChanges seeds once and does not clobber kept edits', () => {
    const out = distFor('chrome')
    const source = fs.mkdtempSync(path.join(SCRATCH, 'src-once-chrome-'))
    fs.writeFileSync(path.join(source, 'seeded.txt'), 'v1-from-source')

    const run1 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true,
      copyFromProfile: source
    })
    const dir1 = String(chromiumUserDataDir(run1))
    expect(fs.readFileSync(path.join(dir1, 'seeded.txt'), 'utf8')).toBe(
      'v1-from-source'
    )

    fs.writeFileSync(path.join(dir1, 'seeded.txt'), 'user-edited')
    fs.writeFileSync(path.join(dir1, 'user-only.txt'), 'keep')

    const run2 = chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome',
      keepProfileChanges: true,
      copyFromProfile: source
    })
    const dir2 = String(chromiumUserDataDir(run2))

    expect(dir2).toBe(dir1)
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

    const run1 = await firefoxConfig(
      makeCompilation(out),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        keepProfileChanges: true,
        copyFromProfile: source
      })
    )
    const dir1 = String(firefoxProfileDir(run1))
    expect(fs.readFileSync(path.join(dir1, 'seeded.txt'), 'utf8')).toBe(
      'v1-from-source'
    )

    fs.writeFileSync(path.join(dir1, 'seeded.txt'), 'user-edited')

    const run2 = await firefoxConfig(
      makeCompilation(out),
      firefoxOptions({
        extension: '/ext',
        browser: 'firefox',
        keepProfileChanges: true,
        copyFromProfile: source
      })
    )
    const dir2 = String(firefoxProfileDir(run2))

    expect(dir2).toBe(dir1)
    expect(fs.readFileSync(path.join(dir2, 'seeded.txt'), 'utf8')).toBe(
      'user-edited'
    )
  })
})

describe('session-root ignore guard', () => {
  let scratch: string

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-e22-guard-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(scratch, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  function ignoreFileFor(out: string) {
    return path.join(path.dirname(out), 'extension-js', '.gitignore')
  }

  it('a managed profile launch drops a self-ignoring .gitignore in the session root', () => {
    const out = path.join(scratch, 'project', 'dist', 'chrome')
    chromiumConfig(makeCompilation(out), {
      extension: '/ext',
      browser: 'chrome'
    })

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
    })

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
    })

    expect(fs.existsSync(ignoreFileFor(out))).toBe(false)
  })
})

describe('profile option coercion', () => {
  let tmpRoot = ''

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-spec-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  function resolve(rawProfile: string | boolean | undefined) {
    return resolveProfileConfig({
      rawProfile,
      managedBaseDir: path.join(tmpRoot, 'profiles', 'chrome-profile'),
      useSystemProfile: false,
      resolveExplicit: (trimmed) => path.resolve(tmpRoot, trimmed)
    })
  }

  describe('normalizeProfileOption', () => {
    it('maps false and the string false to the system profile sentinel', () => {
      expect(normalizeProfileOption(false)).toBe(false)
      expect(normalizeProfileOption('false')).toBe(false)
      expect(normalizeProfileOption('FALSE')).toBe(false)
      expect(normalizeProfileOption(' false ')).toBe(false)
    })

    it('maps true and the string true to the managed default', () => {
      expect(normalizeProfileOption(true)).toBeUndefined()
      expect(normalizeProfileOption('true')).toBeUndefined()
    })

    it('keeps real paths and unset values as they are', () => {
      expect(normalizeProfileOption('/some/profile')).toBe('/some/profile')
      expect(normalizeProfileOption('falsey-dir')).toBe('falsey-dir')
      expect(normalizeProfileOption(undefined)).toBeUndefined()
    })
  })

  describe('resolveProfileConfig profile=false coercion', () => {
    it('treats the string false exactly like the boolean', () => {
      const fromString = resolve('false')
      const fromBoolean = resolve(false)

      expect(fromString.kind).toBe('system')
      expect(fromString.profilePath).toBe('')
      expect(fromBoolean.kind).toBe('system')
      // No literal directory named false is materialized anywhere.
      expect(fs.existsSync(path.resolve(tmpRoot, 'false'))).toBe(false)
    })

    it('still honors an explicit path that merely contains false', () => {
      const resolved = resolve('false-positives')
      expect(resolved.kind).toBe('explicit')
      expect(resolved.profilePath).toBe(
        path.resolve(tmpRoot, 'false-positives')
      )
    })

    it('falls back to a managed profile when unset', () => {
      const resolved = resolve(undefined)
      expect(resolved.kind).toBe('managed')
      expect(resolved.profilePath).toContain(
        path.join('profiles', 'chrome-profile')
      )
    })
  })

  describe('a kept profile an earlier version left at another path', () => {
    function resolveKept(provision = true) {
      return resolveProfileConfig({
        rawProfile: undefined,
        managedBaseDir: path.join(
          tmpRoot,
          'app',
          'dist',
          'extension-js',
          'profiles',
          'chrome-profile'
        ),
        earlierManagedBaseDir: path.join(
          tmpRoot,
          'extension-js',
          'profiles',
          'chrome-profile'
        ),
        useSystemProfile: false,
        persistProfile: true,
        provision,
        browser: 'chrome',
        resolveExplicit: (trimmed) => path.resolve(tmpRoot, trimmed)
      })
    }

    const current = () =>
      path.join(
        tmpRoot,
        'app',
        'dist',
        'extension-js',
        'profiles',
        'chrome-profile',
        'dev'
      )

    const earlier = () =>
      path.join(tmpRoot, 'extension-js', 'profiles', 'chrome-profile', 'dev')

    it('uses the documented place when nothing was left behind', () => {
      const resolved = resolveKept()

      expect(resolved.profilePath).toBe(current())
      expect(fs.existsSync(earlier())).toBe(false)
    })

    it('keeps using the earlier profile and says where the new one lives', () => {
      fs.mkdirSync(earlier(), {recursive: true})
      fs.writeFileSync(path.join(earlier(), 'Cookies'), 'kept')

      const said = vi.spyOn(console, 'log').mockImplementation(() => {})
      const resolved = resolveKept()
      const again = resolveKept()
      const lines = said.mock.calls.map((call) => String(call[0]))

      said.mockRestore()

      expect(resolved.profilePath).toBe(earlier())
      expect(again.profilePath).toBe(earlier())
      expect(resolved.persisted).toBe(true)
      expect(fs.readFileSync(path.join(earlier(), 'Cookies'), 'utf-8')).toBe(
        'kept'
      )

      expect(fs.existsSync(current())).toBe(false)

      const notes = lines.filter((line) => line.includes('earlier version'))

      expect(notes).toHaveLength(1)
      expect(notes[0]).toContain(earlier())
      expect(notes[0]).toContain(current())
    })

    it('prefers a profile that already exists at the documented place', () => {
      fs.mkdirSync(earlier(), {recursive: true})
      fs.writeFileSync(path.join(earlier(), 'Cookies'), 'old')
      fs.mkdirSync(current(), {recursive: true})
      fs.writeFileSync(path.join(current(), 'Cookies'), 'new')

      expect(resolveKept().profilePath).toBe(current())
    })

    it('never reads the earlier path for a fresh profile', () => {
      fs.mkdirSync(earlier(), {recursive: true})
      fs.writeFileSync(path.join(earlier(), 'Cookies'), 'kept')

      const resolved = resolveProfileConfig({
        rawProfile: undefined,
        managedBaseDir: path.dirname(current()),
        earlierManagedBaseDir: path.dirname(earlier()),
        useSystemProfile: false,
        resolveExplicit: (trimmed) => path.resolve(tmpRoot, trimmed)
      })

      expect(resolved.persisted).toBe(false)
      expect(path.dirname(resolved.profilePath)).toBe(path.dirname(current()))
    })
  })
})
