import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {extractActionThemeIcons} from '../extract-action-theme-icons'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive: true, force: true})
})

function manifestWith(content: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-action-theme-'))
  dirs.push(dir)
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(content))
  return {dir, manifestPath}
}

describe('extractActionThemeIcons', () => {
  it('resolves light and dark entries against the manifest folder', () => {
    const {dir, manifestPath} = manifestWith({
      action: {theme_icons: [{light: 'icons/light.png', dark: '/dark.png'}]}
    })
    expect(extractActionThemeIcons(manifestPath)).toEqual({
      'action/theme_icons': [
        path.join(dir, 'icons', 'light.png'),
        path.join(dir, 'dark.png')
      ]
    })
  })

  it('maps public spellings into the public folder', () => {
    const {dir, manifestPath} = manifestWith({
      action: {theme_icons: [{light: 'public/l.png', dark: '/public/d.png'}]}
    })
    expect(extractActionThemeIcons(manifestPath)).toEqual({
      'action/theme_icons': [
        path.join(dir, 'public', 'l.png'),
        path.join(dir, 'public', 'd.png')
      ]
    })
  })

  it('returns nothing without theme_icons or without a readable manifest', () => {
    const {manifestPath} = manifestWith({action: {default_popup: 'p.html'}})
    expect(extractActionThemeIcons(manifestPath)).toEqual({})
    expect(extractActionThemeIcons('/nope/manifest.json')).toEqual({})
  })
})
