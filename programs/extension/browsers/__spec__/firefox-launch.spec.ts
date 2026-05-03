import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {browserConfig} from '../run-firefox/firefox-launch/browser-config'

function makeCompilation(out = '/tmp/project/dist/firefox') {
  return {options: {output: {path: out}}} as any
}

function extractProfilePath(args: string): string {
  const match = args.match(/--profile="([^"]+)"/)
  if (!match) throw new Error('--profile flag not found in firefox args')
  return match[1]
}

describe('Firefox profile args', () => {
  let OLD_ENV: NodeJS.ProcessEnv
  beforeEach(() => {
    vi.restoreAllMocks()
    OLD_ENV = {...process.env}
    process.env = {...OLD_ENV}
  })
  afterEach(() => {
    process.env = OLD_ENV
    try {
      const distRoot = path.join('/tmp', 'project', 'dist')
      fs.rmSync(distRoot, {recursive: true, force: true})
    } catch {}
  })

  it('adds --profile for ephemeral profile by default', async () => {
    const args = await browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox'
    } as any)
    expect(args).toMatch(/--profile="/)
    // Accept any ephemeral profile name under firefox-profile/
    expect(args).toMatch(
      /extension-js[\\/]+profiles[\\/]+firefox-profile[\\/]+/
    )
  })

  it('uses persistent dev profile when persistProfile=true', async () => {
    const args = await browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox',
      persistProfile: true
    } as any)
    expect(args).toMatch(/--profile=".*firefox-profile[\\/]dev"/)
  })

  it('includes startingUrl in binary args when provided', async () => {
    const args = await browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox',
      startingUrl: 'https://en.wikipedia.org/'
    } as any)
    expect(args).toContain('https://en.wikipedia.org/')
  })

  it('does not include startingUrl when noOpen is true', async () => {
    const args = await browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox',
      startingUrl: 'https://en.wikipedia.org/',
      noOpen: true
    } as any)
    expect(args).not.toContain('https://en.wikipedia.org/')
  })

  it('resolves relative explicit profile paths against the compilation context, not process.cwd()', async () => {
    // Regression: matches the Chromium fix in chromium-flags.spec.ts —
    // relative `profile: './dist/extension-profile-firefox'` must anchor to
    // the project that owns extension.config.js so sequential example runs
    // never share a single Firefox profile.
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
      } as any
      const compilationB = {
        options: {
          context: projectB,
          output: {path: path.join(projectB, 'dist', 'firefox')}
        }
      } as any

      const argsA = await browserConfig(compilationA, {
        extension: '/ext',
        browser: 'firefox',
        profile: './dist/extension-profile-firefox'
      } as any)
      const argsB = await browserConfig(compilationB, {
        extension: '/ext',
        browser: 'firefox',
        profile: './dist/extension-profile-firefox'
      } as any)

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
      } catch {}
    }
  })
})
