import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {CompilationLike} from '../../browsers-types'
import {
  type BrowserConfigOptions,
  browserConfig
} from '../../run-firefox/firefox-launch/browser-config'

// A partial host, cast once.
function host(fields: Partial<BrowserConfigOptions>): BrowserConfigOptions {
  return fields as BrowserConfigOptions
}

let project: string

function makeCompilation(out = path.join(project, 'dist', 'firefox')) {
  return {options: {output: {path: out}}} as CompilationLike
}

function extractProfilePath(args: string): string {
  const match = args.match(/--profile="([^"]+)"/)
  if (!match) throw new Error('--profile flag not found in firefox args')

  return match[1]
}

describe('Firefox profile args', () => {
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fx-launch-'))
  })

  afterEach(() => {
    fs.rmSync(project, {recursive: true, force: true})
  })

  it('adds --profile for ephemeral profile by default', async () => {
    const args = await browserConfig(
      makeCompilation(),
      host({
        extension: '/ext',
        browser: 'firefox'
      })
    )
    expect(args).toMatch(/--profile="/)
    expect(args).toMatch(
      /extension-js[\\/]+profiles[\\/]+firefox-profile[\\/]+/
    )
  })

  it('uses persistent dev profile when persistProfile=true', async () => {
    const args = await browserConfig(
      makeCompilation(),
      host({
        extension: '/ext',
        browser: 'firefox',
        persistProfile: true
      })
    )
    expect(args).toMatch(/--profile=".*firefox-profile[\\/]dev"/)
  })

  it('excludeBrowserFlags uses switch semantics, not loose prefixes', async () => {
    const args = await browserConfig(
      makeCompilation(),
      host({
        extension: '/ext',
        browser: 'firefox',
        browserFlags: ['--foobar', '--foo=value', '--kiosk'],
        excludeBrowserFlags: ['--foo']
      })
    )
    expect(args).toContain('--foobar')
    expect(args).toContain('--kiosk')
    expect(args).not.toContain('--foo=value')
  })

  // The debugger opens the starting url after the add-on is installed.
  it('opens about:blank in binary args when a startingUrl is provided', async () => {
    const args = await browserConfig(
      makeCompilation(),
      host({
        extension: '/ext',
        browser: 'firefox',
        startingUrl: 'https://en.wikipedia.org/'
      })
    )
    expect(args).toContain('--url about:blank')
    expect(args).not.toContain('https://en.wikipedia.org/')
  })

  it('opens no launch tab at all when noOpen is true', async () => {
    const args = await browserConfig(
      makeCompilation(),
      host({
        extension: '/ext',
        browser: 'firefox',
        startingUrl: 'https://en.wikipedia.org/',
        noOpen: true
      })
    )
    expect(args).not.toContain('--url')
    expect(args).not.toContain('https://en.wikipedia.org/')
  })

  it('resolves relative explicit profile paths against the compilation context, not process.cwd()', async () => {
    const projectA = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-fx-profile-ctx-a-')
    )
    const projectB = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-fx-profile-ctx-b-')
    )
    const oldCwd = process.cwd()

    try {
      process.chdir(os.tmpdir())

      const compilationA = {
        options: {
          context: projectA,
          output: {path: path.join(projectA, 'dist', 'firefox')}
        }
      } as CompilationLike
      const compilationB = {
        options: {
          context: projectB,
          output: {path: path.join(projectB, 'dist', 'firefox')}
        }
      } as CompilationLike

      const argsA = await browserConfig(
        compilationA,
        host({
          extension: '/ext',
          browser: 'firefox',
          profile: './dist/extension-profile-firefox'
        })
      )
      const argsB = await browserConfig(
        compilationB,
        host({
          extension: '/ext',
          browser: 'firefox',
          profile: './dist/extension-profile-firefox'
        })
      )

      const profileA = extractProfilePath(argsA)
      const profileB = extractProfilePath(argsB)

      expect(profileA).toBe(
        path.resolve(projectA, 'dist', 'extension-profile-firefox')
      )

      expect(profileB).toBe(
        path.resolve(projectB, 'dist', 'extension-profile-firefox')
      )

      expect(profileA).not.toBe(profileB)
    } finally {
      process.chdir(oldCwd)

      try {
        fs.rmSync(projectA, {recursive: true, force: true})
        fs.rmSync(projectB, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }
  })
})
