import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {sidePanel} from '../side_panel'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function projectWith(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-side-panel-'))
  tempDirs.push(dir)
  for (const file of files) {
    const filePath = path.join(dir, file)
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, '<html></html>', 'utf8')
  }
  return path.join(dir, 'manifest.json')
}

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

  it('keeps a panel hosted in public/ at the name the copier ships', () => {
    const manifestPath = projectWith(['public/sidebar/panel.html'])
    const result = sidePanel(
      {
        manifest_version: 3,
        side_panel: {default_path: 'public/sidebar/panel.html'}
      } as any,
      manifestPath
    )

    expect(result?.side_panel?.default_path).toBe('sidebar/panel.html')
  })

  it('keeps a root-absolute panel owned by public/ at the output root', () => {
    const manifestPath = projectWith(['public/panel.html'])
    const result = sidePanel(
      {
        manifest_version: 3,
        side_panel: {default_path: '/panel.html'}
      } as any,
      manifestPath
    )

    expect(result?.side_panel?.default_path).toBe('panel.html')
  })

  it('keeps the compiled slot for a root-absolute panel the pipeline builds', () => {
    const manifestPath = projectWith(['panel.html'])
    const result = sidePanel(
      {
        manifest_version: 3,
        side_panel: {default_path: '/panel.html'}
      } as any,
      manifestPath
    )

    expect(result?.side_panel?.default_path).toBe('sidebar/index.html')
  })
})
