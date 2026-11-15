import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {extractIconVariants} from '../extract-icon-variants'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function manifestWith(content: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-icon-variants-'))
  dirs.push(dir)
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(content))

  return {dir, manifestPath}
}

describe('extractIconVariants', () => {
  it('lists every sized and any entry, top level and under the action', () => {
    const {dir, manifestPath} = manifestWith({
      icon_variants: [
        {16: 'icons/dark-16.png', color_schemes: ['dark']},
        {any: '/icons/any.svg'}
      ],
      action: {
        icon_variants: [{16: 'icons/act-16.png', color_schemes: ['light']}]
      }
    })

    expect(extractIconVariants(manifestPath)).toEqual({
      icon_variants: [
        path.join(dir, 'icons', 'dark-16.png'),
        path.join(dir, 'icons', 'any.svg')
      ],
      'action/icon_variants': [path.join(dir, 'icons', 'act-16.png')]
    })
  })

  it('reads a list under a browser prefix on that target only', () => {
    const {dir, manifestPath} = manifestWith({
      'chromium:icon_variants': [{16: 'c.png'}],
      'firefox:icon_variants': [{16: 'f.png'}]
    })

    expect(extractIconVariants(manifestPath, 'chrome')).toEqual({
      icon_variants: [path.join(dir, 'c.png')]
    })

    expect(extractIconVariants(manifestPath, 'edge')).toEqual({
      icon_variants: [path.join(dir, 'c.png')]
    })

    expect(extractIconVariants(manifestPath, 'firefox')).toEqual({
      icon_variants: [path.join(dir, 'f.png')]
    })
  })

  it('returns nothing for a manifest without the key, a bad shape, or no file', () => {
    expect(extractIconVariants(manifestWith({}).manifestPath)).toEqual({})
    expect(
      extractIconVariants(
        manifestWith({
          icon_variants: {16: 'a.png'},
          action: {icon_variants: [7]}
        }).manifestPath
      )
    ).toEqual({})

    expect(extractIconVariants('/nope/manifest.json')).toEqual({})
  })
})
