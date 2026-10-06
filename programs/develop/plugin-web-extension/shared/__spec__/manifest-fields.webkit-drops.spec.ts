import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {getResolvedManifestFieldsData} from '../manifest-fields'

const roots: string[] = []

function makeProject(manifest: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-webkit-fields-'))
  roots.push(dir)
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))

  return {dir, manifestPath}
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('getResolvedManifestFieldsData for the keys safari drops', () => {
  const manifest = {
    manifest_version: 3,
    name: 'x',
    version: '1.0.0',
    action: {default_popup: 'popup.html'},
    background: {service_worker: 'worker.js'},
    side_panel: {default_path: 'panel.html'},
    sidebar_action: {default_panel: 'side.html', default_icon: 'side.png'},
    sandbox: {pages: ['sbx.html']},
    user_scripts: {api_script: 'api.js'}
  }

  it('discovers no entry a dropped key owned on a safari build', () => {
    const {dir, manifestPath} = makeProject(manifest)
    const data = getResolvedManifestFieldsData({
      manifestPath,
      browser: 'safari'
    })

    expect(data.html).toEqual({'action/index': path.join(dir, 'popup.html')})
    expect(data.scripts['background/service_worker']).toBe(
      path.join(dir, 'worker.js')
    )

    expect(data.scripts).not.toHaveProperty('user_scripts/api_script')
    expect(data.icons).not.toHaveProperty('sidebar_action')
    expect(JSON.stringify(data)).not.toMatch(/panel|side|sbx|api\.js/)
  })

  it('keeps every one of those entries on a chrome build', () => {
    const {dir, manifestPath} = makeProject(manifest)
    const data = getResolvedManifestFieldsData({
      manifestPath,
      browser: 'chrome'
    })

    expect(data.html['sidebar/index']).toBe(path.join(dir, 'panel.html'))
    expect(data.html['sidebar_action/index']).toBe(path.join(dir, 'side.html'))
    expect(data.html['sandbox/page-0']).toBe(path.join(dir, 'sbx.html'))
    expect(data.scripts['user_scripts/api_script']).toBe(
      path.join(dir, 'api.js')
    )

    expect(data.icons.sidebar_action).toBe(path.join(dir, 'side.png'))
  })
})
