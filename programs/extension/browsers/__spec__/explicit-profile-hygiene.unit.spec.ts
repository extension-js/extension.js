import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../browsers-lib/messages'
import {
  ensureExplicitProfileHygiene,
  resetExplicitProfileNotes,
  resolveProfileConfig
} from '../browsers-lib/resolve-profile'
import {browserConfig as chromiumConfig} from '../run-chromium/chromium-launch/browser-config'
import {resolveFirefoxLaunchConfig} from '../run-firefox/firefox-launch/browser-config'

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('a configured profile under the project', () => {
  let scratch: string
  let project: string
  let printed: string[]

  beforeEach(() => {
    scratch = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-hygiene-'))
    )

    project = path.join(scratch, 'project')
    fs.mkdirSync(project, {recursive: true})
    fs.writeFileSync(path.join(project, 'package.json'), '{}')
    printed = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      printed.push(stripAnsi(args.join(' ')))
    })

    resetExplicitProfileNotes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(scratch, {recursive: true, force: true})
  })

  function resolveExplicit(browser: string, profile: string) {
    return resolveProfileConfig({
      rawProfile: profile,
      managedBaseDir: path.join(
        project,
        'dist',
        'extension-js',
        'profiles',
        `${browser}-profile`
      ),
      useSystemProfile: false,
      resolveExplicit: (trimmed) => path.resolve(project, trimmed),
      projectDir: project,
      browser
    })
  }

  it('gets the ignore file, the README and one line that says what it holds', () => {
    const resolved = resolveExplicit(
      'chrome',
      './dist/extension-profile-chrome'
    )
    const profile = path.join(project, 'dist', 'extension-profile-chrome')

    expect(resolved).toEqual({
      kind: 'explicit',
      profilePath: profile,
      persisted: false
    })

    expect(fs.readFileSync(path.join(profile, '.gitignore'), 'utf8')).toMatch(
      /cookies, history, logins[\s\S]*\n\*\n$/
    )

    const readme = fs.readFileSync(path.join(profile, 'README.md'), 'utf8')
    expect(readme).toContain('# dist/extension-profile-chrome')
    expect(readme).toContain('browser.chrome.profile')
    expect(readme).toContain('cookies, history and logins')

    const note = printed.find((line) => /keeps cookies and logins/.test(line))
    expect(note).toBe(
      stripAnsi(
        messages.explicitProfileUnderProject(
          'chrome',
          'dist/extension-profile-chrome',
          true
        )
      )
    )

    expect(note).toContain('Git ignores it')
    expect(note).toContain('beside your store zips under dist/')
    expect(note).toContain('browser.chrome.persistProfile')

    // The line prints once per profile, not once per resolve.
    resolveExplicit('chrome', './dist/extension-profile-chrome')
    expect(
      printed.filter((line) => /keeps cookies and logins/.test(line))
    ).toHaveLength(1)
  })

  it('says nothing about store zips for a profile outside dist/', () => {
    resolveExplicit('firefox', './.profiles/firefox')
    const note = printed.find((line) => /keeps cookies and logins/.test(line))

    expect(note).toContain('.profiles/firefox')
    expect(note).not.toContain('store zips')
    expect(
      fs.existsSync(path.join(project, '.profiles', 'firefox', '.gitignore'))
    ).toBe(true)
  })

  it('keeps an existing ignore file and README as they are', () => {
    const profile = path.join(project, 'dist', 'extension-profile-chrome')
    fs.mkdirSync(profile, {recursive: true})
    fs.writeFileSync(path.join(profile, '.gitignore'), 'mine\n')
    fs.writeFileSync(path.join(profile, 'README.md'), '# mine\n')

    resolveExplicit('chrome', './dist/extension-profile-chrome')

    expect(fs.readFileSync(path.join(profile, '.gitignore'), 'utf8')).toBe(
      'mine\n'
    )

    expect(fs.readFileSync(path.join(profile, 'README.md'), 'utf8')).toBe(
      '# mine\n'
    )
  })

  it('writes nothing into a folder that is not a profile of this project', () => {
    const outside = path.join(scratch, 'elsewhere')

    expect(ensureExplicitProfileHygiene(outside, project, 'chrome')).toBeNull()
    expect(fs.existsSync(path.join(outside, '.gitignore'))).toBe(false)

    // The project itself, a parent of it, and a folder holding project files.
    expect(ensureExplicitProfileHygiene(project, project, 'chrome')).toBeNull()
    expect(ensureExplicitProfileHygiene(scratch, project, 'chrome')).toBeNull()
    const sub = path.join(project, 'packages', 'app')
    fs.mkdirSync(sub, {recursive: true})
    fs.writeFileSync(path.join(sub, 'package.json'), '{}')
    expect(ensureExplicitProfileHygiene(sub, project, 'chrome')).toBeNull()

    expect(fs.existsSync(path.join(project, '.gitignore'))).toBe(false)
    expect(fs.existsSync(path.join(sub, '.gitignore'))).toBe(false)
    expect(printed.some((line) => /keeps cookies/.test(line))).toBe(false)
  })

  it('a dry run writes nothing', () => {
    resolveProfileConfig({
      rawProfile: './dist/extension-profile-chrome',
      managedBaseDir: path.join(project, 'dist', 'extension-js', 'profiles'),
      useSystemProfile: false,
      resolveExplicit: (trimmed) => path.resolve(project, trimmed),
      projectDir: project,
      browser: 'chrome',
      provision: false
    })

    expect(
      fs.existsSync(path.join(project, 'dist', 'extension-profile-chrome'))
    ).toBe(false)
  })

  it('both launchers hand the project root through', () => {
    const compilation = (browser: string) =>
      ({
        options: {
          context: project,
          output: {path: path.join(project, 'dist', browser)}
        }
      }) as any

    chromiumConfig(compilation('chrome'), {
      extension: '/ext',
      browser: 'chrome',
      profile: './dist/extension-profile-chrome'
    } as any)

    resolveFirefoxLaunchConfig(compilation('firefox'), {
      extension: '/ext',
      browser: 'firefox',
      profile: './dist/extension-profile-firefox'
    } as any)

    for (const browser of ['chrome', 'firefox']) {
      const profile = path.join(project, 'dist', `extension-profile-${browser}`)
      expect(fs.readFileSync(path.join(profile, '.gitignore'), 'utf8')).toMatch(
        /\n\*\n$/
      )

      expect(fs.existsSync(path.join(profile, 'README.md'))).toBe(true)
    }

    expect(
      printed.filter((line) => /keeps cookies and logins/.test(line))
    ).toHaveLength(2)
  })
})
