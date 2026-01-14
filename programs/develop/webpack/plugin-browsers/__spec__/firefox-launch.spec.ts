import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {browserConfig} from '../run-firefox/firefox-launch/browser-config'

function makeCompilation(out = '/tmp/project/dist/firefox') {
  return {options: {output: {path: out}}} as any
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
    expect(args).toMatch(/extension-js\/profiles\/firefox-profile\//)
  })

  it('uses persistent dev profile when persistProfile=true', async () => {
    const args = await browserConfig(makeCompilation(), {
      extension: '/ext',
      browser: 'firefox',
      persistProfile: true
    } as any)
    expect(args).toMatch(/--profile=".*firefox-profile\/dev"/)
  })
})

