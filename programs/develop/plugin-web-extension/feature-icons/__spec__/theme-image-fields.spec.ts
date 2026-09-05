import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {themeImageFields} from '../theme-image-fields'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive: true, force: true})
})

function manifestWith(theme: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-theme-fields-'))
  dirs.push(dir)
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify({theme}))
  return {dir, manifestPath}
}

describe('themeImageFields', () => {
  it('keys every image by its theme.images property and keeps each path', () => {
    const {dir, manifestPath} = manifestWith({
      images: {
        theme_frame: 'images/frame.png',
        additional_backgrounds: ['images/light/bg.png', 'images/dark/bg.png']
      }
    })
    expect(themeImageFields(manifestPath)).toEqual({
      'theme/images/theme_frame': path.join(dir, 'images/frame.png'),
      'theme/images/additional_backgrounds': [
        path.join(dir, 'images/light/bg.png'),
        path.join(dir, 'images/dark/bg.png')
      ]
    })
  })

  it('leaves root-absolute spellings raw for the emitter', () => {
    const {manifestPath} = manifestWith({images: {theme_frame: '/frame.png'}})
    expect(themeImageFields(manifestPath)).toEqual({
      'theme/images/theme_frame': '/frame.png'
    })
  })

  it('returns nothing without images or without a readable manifest', () => {
    expect(themeImageFields(manifestWith({colors: {}}).manifestPath)).toEqual(
      {}
    )
    expect(themeImageFields('/nope/manifest.json')).toEqual({})
  })
})
