import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-mistyped-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'mistyped', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'Mistyped Fields',
      version: '1.0.0',
      ...manifest
    })
  )

  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("content")')
  fs.writeFileSync(path.join(root, 'bg.js'), 'console.log("background")')
  fs.writeFileSync(
    path.join(root, 'sandbox.html'),
    '<html><body>sandbox</body></html>'
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const printed: string[] = []

  const record = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation(record)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record)
  let failure: unknown

  try {
    await extensionBuild(root, {
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

  const rendered = printed.join('\n').replace(/\[[0-9;]*m/g, '')

  return {failure, rendered}
}

function readManifest(root: string) {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'dist', 'chrome', 'manifest.json'), 'utf-8')
  )
}

describe('mistyped manifest values (real build)', () => {
  it('refuses content_scripts written as a single object and names the field', async () => {
    const root = project({
      manifest_version: 3,
      content_scripts: {matches: ['<all_urls>'], js: ['content.js']}
    })
    const {failure, rendered} = await build(root)

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(String(failure)).not.toMatch(/TypeError/)
    expect(rendered).not.toMatch(/TypeError|is not a function/)
    expect(rendered).toMatch(/content_scripts/)
    expect(rendered).toMatch(/array/i)
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  }, 120_000)

  it('refuses sandbox.pages written as a string and names the field', async () => {
    const root = project({
      manifest_version: 3,
      sandbox: {pages: 'sandbox.html'}
    })
    const {failure, rendered} = await build(root)

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).not.toMatch(/TypeError|is not a function/)
    expect(rendered).toMatch(/sandbox\.pages/)
    expect(rendered).toMatch(/array/i)
  }, 120_000)

  it('refuses background.scripts written as a string and names the field', async () => {
    const root = project({
      manifest_version: 2,
      background: {scripts: 'bg.js'}
    })
    const {failure, rendered} = await build(root)

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).not.toMatch(/TypeError|is not a function/)
    expect(rendered).toMatch(/background\.scripts/)
    expect(rendered).toMatch(/array/i)
  }, 120_000)

  it('repairs a string permissions into an array and says so', async () => {
    const root = project({
      manifest_version: 3,
      permissions: 'storage',
      host_permissions: '<all_urls>'
    })
    const {failure, rendered} = await build(root)

    expect(failure).toBeUndefined()
    expect(rendered).toMatch(/Repaired the permissions field/)
    expect(rendered).toMatch(/Repaired the host_permissions field/)
    expect(readManifest(root).permissions).toEqual(['storage'])
    expect(readManifest(root).host_permissions).toEqual(['<all_urls>'])
  }, 120_000)
})
