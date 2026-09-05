import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {theme} from '../theme'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive: true, force: true})
})

function project(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-theme-override-'))
  dirs.push(dir)
  for (const file of files) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, 'png')
  }
  return path.join(dir, 'manifest.json')
}

describe('theme (images override)', () => {
  it('rewrites in-project images to their own path under the theme folder', () => {
    const manifestPath = project([
      'images/frame.png',
      'images/light/bg.png',
      'images/dark/bg.png'
    ])
    const result = theme(
      {
        theme: {
          images: {
            theme_frame: 'images/frame.png',
            additional_backgrounds: [
              'images/light/bg.png',
              'images/dark/bg.png'
            ]
          }
        }
      } as any,
      manifestPath
    )
    expect(result?.theme.images).toEqual({
      theme_frame: 'theme/images/images/frame.png',
      additional_backgrounds: [
        'theme/images/images/light/bg.png',
        'theme/images/images/dark/bg.png'
      ]
    })
  })

  it('keeps a public-hosted image at the path the copier ships it to', () => {
    const manifestPath = project(['public/frame.png', 'public/bg.png'])
    const result = theme(
      {
        theme: {
          images: {
            theme_frame: 'public/frame.png',
            additional_backgrounds: ['/bg.png']
          }
        }
      } as any,
      manifestPath
    )
    expect(result?.theme.images).toEqual({
      theme_frame: 'frame.png',
      additional_backgrounds: ['bg.png']
    })
  })
})
