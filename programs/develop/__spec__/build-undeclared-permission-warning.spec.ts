import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project(permissions: string[]) {
  const root = tempFolder('extjs-undeclared-perm-')

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'undeclared', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'undeclared',
      version: '1.0.0',
      permissions,
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    'chrome.tabs.query({active: true}, (tabs) => console.log(tabs[0].url, tabs[0].title))\n'
  )

  return root
}

async function build(root: string) {
  return buildProject(root, {
    mode: 'production'
  })
}

function permissionWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.includes('does not declare the "tabs" permission')
  )
}

describe('a production build and a permission the source leans on', () => {
  it('warns when the manifest never declares tabs', async () => {
    const summary = await build(project([]))

    expect(summary.errors_count).toBe(0)
    const warnings = permissionWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('background.js')
    expect(warnings[0]).toContain('Add "tabs" to permissions')
  })

  it('names what activeTab already grants instead of asking for tabs', async () => {
    const summary = await build(project(['activeTab']))

    expect(summary.errors_count).toBe(0)
    const warnings = permissionWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"activeTab" is declared')
    expect(warnings[0]).toContain('captureVisibleTab')
    expect(warnings[0]).not.toContain('Nothing grants it here')
    expect(warnings[0]).not.toContain(
      'Add "tabs" to permissions in manifest.json'
    )
  })

  it('stays quiet once tabs is declared', async () => {
    const summary = await build(project(['tabs']))

    expect(summary.errors_count).toBe(0)
    expect(permissionWarnings(summary)).toEqual([])
  })
})
