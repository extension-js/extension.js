import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(manifest: Record<string, unknown>, folders: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-folder-refs-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'folder-refs', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Folder Refs',
      version: '1.0.0',
      ...manifest
    })
  )

  for (const folder of folders) {
    fs.mkdirSync(path.join(root, folder), {recursive: true})
  }

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

describe('manifest references that resolve to a folder (real build)', () => {
  it('refuses an icons entry that is a folder and names the field and path', async () => {
    const root = project({icons: {'16': 'images'}}, ['images'])
    const {failure, rendered} = await build(root)

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).not.toMatch(/EISDIR/)
    expect(rendered).toMatch(/icons/)
    expect(rendered).toMatch(/[\\/]images\b/)
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  }, 120_000)

  it('refuses an action.default_icon that is a folder', async () => {
    const root = project({action: {default_icon: 'images'}}, ['images'])
    const {failure, rendered} = await build(root)

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).not.toMatch(/EISDIR/)
    expect(rendered).toMatch(/action\.default_icon|action\/default_icon/)
    expect(rendered).toMatch(/[\\/]images\b/)
  }, 120_000)

  it('refuses a storage.managed_schema that is a folder', async () => {
    const root = project(
      {permissions: ['storage'], storage: {managed_schema: 'schemas'}},
      ['schemas']
    )
    const {failure, rendered} = await build(root)

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).not.toMatch(/EISDIR/)
    expect(rendered).toMatch(/managed_schema/)
    expect(rendered).toMatch(/[\\/]schemas\b/)
  }, 120_000)

  it('reports a page asset that is a folder instead of crashing the compile', async () => {
    const root = project({action: {default_popup: 'popup.html'}}, ['images'])
    fs.writeFileSync(
      path.join(root, 'popup.html'),
      '<html><body><img src="./images"></body></html>'
    )

    const {failure, rendered} = await build(root)

    expect(failure).toBeUndefined()
    expect(rendered).not.toMatch(/EISDIR/)
    expect(rendered).toMatch(/popup\.html/)
    expect(rendered).toMatch(/[\\/]images\b/)
    expect(
      fs.existsSync(path.join(root, 'dist', 'chrome', 'manifest.json'))
    ).toBe(true)
  }, 120_000)
})
