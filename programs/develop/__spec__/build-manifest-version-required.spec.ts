import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-version-'))

function write(relPath: string, contents: string) {
  const abs = path.join(ROOT, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

async function build(browser: 'edge' | 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const printed: string[] = []

  const record = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation(record)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record)

  let failure: unknown

  try {
    await extensionBuild(ROOT, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } catch (error) {
    failure = error
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }

  // Color codes can split words mid-phrase; strip them before matching.
  const rendered = printed.join('\n').replace(/\[[0-9;]*m/g, '')

  return {failure, rendered}
}

function readManifest(browser: string) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'dist', browser, 'manifest.json'), 'utf-8')
  )
}

beforeAll(() => {
  write(
    'package.json',
    JSON.stringify({private: true, name: 'manifest-version-spec'})
  )

  // chrome: and firefox: each carry a manifest_version and nothing plain
  // does, so an edge build resolves to none.
  write(
    'manifest.json',
    JSON.stringify({
      name: 'Manifest Version Fixture',
      version: '1.0.0',
      'firefox:manifest_version': 2,
      'chrome:manifest_version': 3,
      'chrome:action': {default_title: 't'}
    })
  )
})

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('manifest_version lost to a vendor prefix (real build)', () => {
  it('refuses the edge build and names the chrome: key that carried it', async () => {
    const {failure, rendered} = await build('edge')

    expect(failure).toBeTruthy()
    expect(rendered).toMatch(/chrome:manifest_version/)
    expect(rendered).toMatch(/edge build has no manifest_version/)
    expect(rendered).toMatch(/chromium:manifest_version/)
    expect(fs.existsSync(path.join(ROOT, 'dist', 'edge'))).toBe(false)
  }, 120_000)

  it('builds for chrome with manifest_version 3', async () => {
    const {failure} = await build('chrome')

    expect(failure).toBeUndefined()
    expect(readManifest('chrome').manifest_version).toBe(3)
  }, 120_000)

  it('builds for firefox with manifest_version 2', async () => {
    const {failure} = await build('firefox')

    expect(failure).toBeUndefined()
    expect(readManifest('firefox').manifest_version).toBe(2)
  }, 120_000)
})
