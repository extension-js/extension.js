import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {browserConfig} from '../run-chromium/browser-config'

function makeCompilation(
  out = path.join(os.tmpdir(), 'project', 'dist', 'chrome')
) {
  // Align with browserConfig expectations: Compilation.options.output.path
  return {options: {output: {path: out}}} as any
}

describe('Chromium profile flags', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = {...OLD_ENV}
  })
  afterEach(() => {
    process.env = OLD_ENV
    // Cleanup any temp output created under /tmp/project/dist
    try {
      const distRoot = path.join(os.tmpdir(), 'project', 'dist')
      fs.rmSync(distRoot, {recursive: true, force: true})
    } catch {}
  })

  it('adds --user-data-dir for ephemeral profile by default', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome'
    } as any)
    const userDir = flags.find((f: string) => f.startsWith('--user-data-dir='))
    expect(userDir).toBeTruthy()
    expect(userDir).toMatch(/extension-js\/profiles\/chrome-profile\/tmp-/)
  })

  it('uses persistent dev profile when persistProfile=true', () => {
    const flags = browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'chrome',
      persistProfile: true
    } as any)
    const userDir = flags.find((f: string) => f.startsWith('--user-data-dir='))
    expect(userDir).toBeTruthy()
    // Allow optional trailing quote
    expect(userDir).toMatch(/extension-js\/profiles\/chrome-profile\/dev"?$/)
  })
})
