import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-manifest-'))

function write(relPath: string, contents: string) {
  const abs = path.join(ROOT, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

beforeAll(() => {
  write(
    'package.json',
    JSON.stringify({private: true, name: 'public-manifest-spec'})
  )
  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Public Manifest Fixture',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )
  write('popup.html', '<html><body>popup</body></html>\n')
  write('public/manifest.json', JSON.stringify({name: 'copied verbatim'}))
  write('public/vendor/manifest.json', JSON.stringify({nested: true}))
})

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('manifest under public/ (real build)', () => {
  it('refuses with the contract error alone, no asset-conflict noise', async () => {
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
        browser: 'chrome',
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

    expect(failure).toBeTruthy()
    // Color codes can split words mid-phrase; strip them before matching.
    const rendered = printed.join('\n').replace(/\[[0-9;]*m/g, '')
    expect(rendered).toMatch(/must not be placed under public\//)
    expect(rendered).not.toMatch(/Conflict: Multiple assets/)
  }, 120_000)

  it('still copies nested public manifests once the root one is removed', async () => {
    fs.rmSync(path.join(ROOT, 'public', 'manifest.json'))

    const {extensionBuild} = await import('../command-build')
    await extensionBuild(ROOT, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)

    const dist = path.join(ROOT, 'dist', 'chrome')
    expect(fs.existsSync(path.join(dist, 'vendor', 'manifest.json'))).toBe(true)
    const generated = JSON.parse(
      fs.readFileSync(path.join(dist, 'manifest.json'), 'utf-8')
    )
    expect(generated.name).toBe('Public Manifest Fixture')
  }, 120_000)
})
