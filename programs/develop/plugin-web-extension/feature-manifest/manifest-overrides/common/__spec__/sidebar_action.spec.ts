import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {sidebarAction} from '../sidebar_action'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function projectWith(files: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-sidebar-action-'))
  tempDirs.push(dir)
  for (const file of files) {
    const filePath = path.join(dir, file)
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, '<html></html>', 'utf8')
  }
  return path.join(dir, 'manifest.json')
}

describe('sidebarAction (common override)', () => {
  it('resolves an in-project panel to the compiled sidebar slot', () => {
    const manifestPath = projectWith(['src/sidebar/index.html'])
    const result = sidebarAction(
      {
        manifest_version: 2,
        sidebar_action: {
          default_panel: 'src/sidebar/index.html',
          default_title: 'Panel'
        }
      } as any,
      manifestPath
    )

    expect(result).toEqual({
      sidebar_action: {
        default_panel: 'sidebar/index.html',
        default_title: 'Panel'
      }
    })
  })

  it('returns undefined when the manifest has no sidebar_action', () => {
    expect(sidebarAction({manifest_version: 2} as any)).toBeUndefined()
  })

  it('keeps a panel hosted in public/ at the name the copier ships', () => {
    const manifestPath = projectWith(['public/sidebar/panel.html'])
    const result = sidebarAction(
      {
        manifest_version: 2,
        sidebar_action: {default_panel: 'public/sidebar/panel.html'}
      } as any,
      manifestPath
    )

    expect(result?.sidebar_action?.default_panel).toBe('sidebar/panel.html')
  })

  it('keeps a root-absolute panel owned by public/ at the output root', () => {
    const manifestPath = projectWith(['public/panel.html'])
    const result = sidebarAction(
      {
        manifest_version: 2,
        sidebar_action: {default_panel: '/panel.html'}
      } as any,
      manifestPath
    )

    expect(result?.sidebar_action?.default_panel).toBe('panel.html')
  })

  it('keeps the icon rewrite untouched while resolving the panel', () => {
    const manifestPath = projectWith(['public/sidebar/panel.html'])
    const result = sidebarAction(
      {
        manifest_version: 2,
        sidebar_action: {
          default_panel: 'public/sidebar/panel.html',
          default_icon: {'16': 'images/icon16.png'}
        }
      } as any,
      manifestPath
    )

    expect(result?.sidebar_action?.default_panel).toBe('sidebar/panel.html')
    expect(result?.sidebar_action?.default_icon).toEqual({
      '16': 'images/icon16.png'
    })
  })
})
