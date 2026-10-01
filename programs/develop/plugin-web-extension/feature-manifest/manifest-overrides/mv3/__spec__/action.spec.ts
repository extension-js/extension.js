import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {action} from '../action'

describe('action (MV3 override)', () => {
  it('rewrites theme_icons the way the icons emitter lays them out', () => {
    const out = action({
      action: {
        default_popup: 'popup.html',
        theme_icons: [
          {light: 'icons/light.png', dark: '../design/dark/logo.png', size: 16},
          {light: 'public/l32.png', dark: '../design/light/logo.png', size: 32}
        ]
      }
    } as any) as any
    expect(out.action.default_popup).toBe('action/index.html')
    expect(out.action.theme_icons).toEqual([
      {
        light: 'action/icons/light.png',
        dark: 'action/_/design/dark/logo.png',
        size: 16
      },
      {light: 'l32.png', dark: 'action/_/design/light/logo.png', size: 32}
    ])
  })

  it('leaves an action without theme_icons untouched', () => {
    const out = action({action: {default_icon: 'icons/a.png'}} as any) as any
    expect(out.action.theme_icons).toBeUndefined()
    expect(out.action.default_icon).toBe('icons/a.png')
  })
})

describe('action popup hosted in public/', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
    }
  })

  function project(files: string[]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-action-public-'))
    tempDirs.push(root)

    for (const file of files) {
      const abs = path.join(root, file)
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, '<html></html>')
    }

    return {root, manifestPath: path.join(root, 'src', 'manifest.json')}
  }

  it('keeps the popup name when the root public/ ships it', () => {
    const {root, manifestPath} = project([
      'src/manifest.json',
      'public/app/popups/not-found.html'
    ])
    const out = action(
      {action: {default_popup: 'app/popups/not-found.html'}} as any,
      manifestPath,
      root
    ) as any
    expect(out.action.default_popup).toBe('app/popups/not-found.html')
  })

  it('compiles a popup that lives beside the manifest', () => {
    const {root, manifestPath} = project([
      'src/manifest.json',
      'src/popup.html'
    ])
    const out = action(
      {action: {default_popup: 'popup.html'}} as any,
      manifestPath,
      root
    ) as any
    expect(out.action.default_popup).toBe('action/index.html')
  })
})
