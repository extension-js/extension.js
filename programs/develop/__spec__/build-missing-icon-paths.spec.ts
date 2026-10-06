import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  manifest: Record<string, unknown>,
  files: Record<string, string> = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-missing-icons-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'missing-icons', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'Missing Icons', version: '1.0.0', ...manifest})
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
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

  const rendered = printed.join('\n').replace(/\[[0-9;]*m/g, '')

  return {failure, rendered}
}

describe('manifest icon paths that nothing emits (real build)', () => {
  it('stops the build for a missing icons entry and names the key and path', async () => {
    const root = project({
      manifest_version: 3,
      icons: {'16': 'icons/absent-map-icon.png'}
    })
    const {failure, rendered} = await build(root, 'chrome')

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).toMatch(/Build failed with 1 error\./)
    expect(rendered).toMatch(/Can't find an icon file listed in icons\./)
    expect(rendered).toMatch(/NOT FOUND.*[\\/]icons[\\/]absent-map-icon\.png/)
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  }, 120_000)

  it('stops the build for a missing action.default_icon', async () => {
    const root = project({
      manifest_version: 3,
      action: {default_icon: {'16': 'icons/absent-action-icon.png'}}
    })
    const {failure, rendered} = await build(root, 'chrome')

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).toMatch(/Build failed with 1 error\./)
    expect(rendered).toMatch(
      /Can't find an icon file listed in action\/default_icon\./
    )

    expect(rendered).toMatch(
      /NOT FOUND.*[\\/]icons[\\/]absent-action-icon\.png/
    )
  }, 120_000)

  it('stops the firefox build for a missing browser_action.theme_icons pair', async () => {
    const root = project(
      {
        manifest_version: 2,
        browser_action: {
          default_icon: 'icons/present.png',
          theme_icons: [
            {
              light: 'icons/absent-theme-light.png',
              dark: 'icons/absent-theme-dark.png',
              size: 16
            }
          ]
        }
      },
      {'icons/present.png': 'PRESENT'}
    )
    const {failure, rendered} = await build(root, 'firefox')

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).toMatch(/Build failed with 2 errors\./)
    expect(rendered).toMatch(
      /Can't find an icon file listed in browser_action\/theme_icons\./
    )

    expect(rendered).toMatch(
      /NOT FOUND.*[\\/]icons[\\/]absent-theme-light\.png/
    )

    expect(rendered).toMatch(/NOT FOUND.*[\\/]icons[\\/]absent-theme-dark\.png/)
    expect(rendered).not.toMatch(/The build continues/)
    expect(fs.existsSync(path.join(root, 'dist', 'firefox'))).toBe(false)
  }, 120_000)

  it('stops the firefox build for a missing action.theme_icons file (MV3)', async () => {
    const root = project(
      {
        manifest_version: 3,
        action: {
          default_icon: 'icons/present.png',
          theme_icons: [
            {
              light: 'icons/present.png',
              dark: 'icons/absent-mv3-theme-dark.png',
              size: 16
            }
          ]
        }
      },
      {'icons/present.png': 'PRESENT'}
    )
    const {failure, rendered} = await build(root, 'firefox')

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).toMatch(/Build failed with 1 error\./)
    expect(rendered).toMatch(
      /Can't find an icon file listed in action\/theme_icons\./
    )

    expect(rendered).toMatch(
      /NOT FOUND.*[\\/]icons[\\/]absent-mv3-theme-dark\.png/
    )
  }, 120_000)
})
