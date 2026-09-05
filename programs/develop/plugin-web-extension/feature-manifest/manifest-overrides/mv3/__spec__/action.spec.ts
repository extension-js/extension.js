import {describe, expect, it} from 'vitest'
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
        light: 'action/light.png',
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
