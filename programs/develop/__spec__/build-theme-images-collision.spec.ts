import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {
  writeExtensionProject,
  writeProjectFiles
} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// Two theme images that share a basename in different folders are two
// files. The built manifest must name two output paths and dist must hold
// each file's own bytes, or additional_backgrounds pairs up with the wrong
// alignment and tiling entries in silence.
const tempFolder = trackTempFolders()

function project(files: Record<string, string>, images: unknown) {
  const root = tempFolder('extjs-theme-images-')
  writeExtensionProject(root, {
    manifest: {
      name: 'Theme',
      theme: {
        images,
        colors: {frame: [1, 2, 3]},
        properties: {
          additional_backgrounds_alignment: ['left top', 'right bottom'],
          additional_backgrounds_tiling: ['no-repeat', 'repeat']
        }
      }
    },
    packageJson: {name: 'theme'}
  })

  writeProjectFiles(root, files)

  return root
}

async function build(root: string) {
  const summary = await buildProject(root, {mode: 'production'})
  expect(summary.errors_count).toBe(0)

  const distDir = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const read = (rel: string) => fs.readFileSync(path.join(distDir, rel), 'utf8')

  return {distDir, manifest, read}
}

describe('theme images that share a basename', () => {
  it('ship as two files that the manifest tells apart', async () => {
    const {distDir, manifest, read} = await build(
      project(
        {
          'images/frame.png': 'FRAME',
          'images/light/bg.png': 'LIGHT',
          'images/dark/bg.png': 'DARK'
        },
        {
          theme_frame: 'images/frame.png',
          additional_backgrounds: ['images/light/bg.png', 'images/dark/bg.png']
        }
      )
    )
    const [light, dark] = manifest.theme.images.additional_backgrounds
    expect(light).not.toBe(dark)
    expect(read(light)).toBe('LIGHT')
    expect(read(dark)).toBe('DARK')
    expect(read(manifest.theme.images.theme_frame)).toBe('FRAME')

    for (const rel of [light, dark, manifest.theme.images.theme_frame]) {
      expect(rel.split('/')).not.toContain('..')
      expect(fs.existsSync(path.join(distDir, rel))).toBe(true)
    }
  }, 120_000)
})
