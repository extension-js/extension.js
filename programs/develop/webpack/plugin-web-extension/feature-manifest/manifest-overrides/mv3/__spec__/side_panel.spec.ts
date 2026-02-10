import {describe, it, expect} from 'vitest'
import {sidePanel} from '../side_panel'

describe('sidePanel (MV3 override)', () => {
  it('resolves side_panel.default_path to canonical output path sidebar/index.html', () => {
    const result = sidePanel({
      manifest_version: 3,
      side_panel: {
        default_path: 'src/sidebar/index.html',
        default_title: 'Panel'
      }
    } as any)

    expect(result).toEqual({
      side_panel: {
        default_path: 'sidebar/index.html',
        default_title: 'Panel'
      }
    })
  })

  it('returns undefined when manifest has no side_panel', () => {
    const result = sidePanel({manifest_version: 3} as any)
    expect(result).toBeUndefined()
  })

  it('preserves default_title when resolving default_path', () => {
    const result = sidePanel({
      manifest_version: 3,
      side_panel: {
        default_path: 'pages/panel.html',
        default_title: 'My Panel'
      }
    } as any)

    expect(result?.side_panel?.default_path).toBe('sidebar/index.html')
    expect(result?.side_panel?.default_title).toBe('My Panel')
  })
})
