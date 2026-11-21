import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeProjectFiles} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// Icons that share a basename in different folders are different files, so
// the built manifest must name distinct output paths that each carry their
// own bytes, for the icons map, action icons and theme_icons alike.
const tempFolder = trackTempFolders()

function project(
  manifest: Record<string, unknown>,
  files: Record<string, string>
) {
  const root = tempFolder('extjs-icon-collisions-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'icons', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'Icons', version: '1.0.0', ...manifest})
  )

  writeProjectFiles(root, files)

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const summary = await buildProject(root, {browser, mode: 'production'})
  expect(summary.errors_count).toBe(0)

  const distDir = path.join(root, 'dist', browser)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )

  const read = (rel: string) => {
    expect(fs.existsSync(path.join(distDir, rel)), `${rel} missing`).toBe(true)

    return fs.readFileSync(path.join(distDir, rel), 'utf8')
  }

  return {manifest, read}
}

describe('icons that share a basename', () => {
  it('stay apart across the icons map and action.default_icon (chrome MV3)', async () => {
    const {manifest, read} = await build(
      project(
        {
          manifest_version: 3,
          icons: {'16': 'icons/small/icon.png', '128': 'icons/large/icon.png'},
          action: {default_icon: {'16': 'icons/small/icon.png'}}
        },
        {
          'icons/small/icon.png': 'SMALL',
          'icons/large/icon.png': 'LARGE'
        }
      ),
      'chrome'
    )
    expect(manifest.icons['16']).not.toBe(manifest.icons['128'])
    expect(read(manifest.icons['16'])).toBe('SMALL')
    expect(read(manifest.icons['128'])).toBe('LARGE')
    expect(read(manifest.action.default_icon['16'])).toBe('SMALL')
  }, 120_000)

  it('stay apart for browser_action.theme_icons light and dark (firefox MV2)', async () => {
    const {manifest, read} = await build(
      project(
        {
          manifest_version: 2,
          browser_action: {
            default_icon: 'icons/light/icon.png',
            theme_icons: [
              {
                light: 'icons/light/icon.png',
                dark: 'icons/dark/icon.png',
                size: 16
              }
            ]
          }
        },
        {
          'icons/light/icon.png': 'LIGHT',
          'icons/dark/icon.png': 'DARK'
        }
      ),
      'firefox'
    )
    const [pair] = manifest.browser_action.theme_icons
    expect(pair.light).not.toBe(pair.dark)
    expect(read(pair.light)).toBe('LIGHT')
    expect(read(pair.dark)).toBe('DARK')
    expect(read(manifest.browser_action.default_icon)).toBe('LIGHT')
  }, 120_000)
})
