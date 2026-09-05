import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Two theme images that share a basename in different folders are two
// files. The built manifest must name two output paths and dist must hold
// each file's own bytes, or additional_backgrounds pairs up with the wrong
// alignment and tiling entries in silence.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>, images: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-theme-images-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'theme', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Theme',
      version: '1.0.0',
      theme: {
        images,
        colors: {frame: [1, 2, 3]},
        properties: {
          additional_backgrounds_alignment: ['left top', 'right bottom'],
          additional_backgrounds_tiling: ['no-repeat', 'repeat']
        }
      }
    })
  )
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }
  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
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
