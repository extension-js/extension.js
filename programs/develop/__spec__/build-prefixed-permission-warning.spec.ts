import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project(keys: Record<string, unknown>, source: string) {
  const root = tempFolder('extjs-prefixed-perm-')

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'repro-perm', version: '1.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      name: 'repro-perm',
      version: '1.0.0',
      background: {
        'chromium:service_worker': 'background.js',
        'firefox:scripts': ['background.js']
      },
      ...keys
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), source)

  return root
}

const STORAGE = 'chrome.storage.local.get("a").then(console.log)\n'
const TAB_FIELDS =
  'chrome.tabs.query({active: true}, (tabs) => console.log(tabs[0].url, tabs[0].title))\n'

async function build(root: string, browser: 'chrome' | 'firefox') {
  return buildProject(root, {
    browser,
    mode: 'production'
  })
}

function shipped(root: string, browser: string) {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
  )
}

function about(summary: {warnings?: string[]}, api: string) {
  return (summary.warnings || []).filter(
    (text) =>
      text.includes(`"${api}" permission`) && text.includes('background.js')
  )
}

describe('a permission a prefixed key replaced out of the build', () => {
  it('names the prefixed key on the Chrome build of the plain list', async () => {
    const root = project(
      {permissions: ['storage'], 'chromium:permissions': ['sidePanel']},
      STORAGE
    )
    const summary = await build(root, 'chrome')

    expect(summary.errors_count).toBe(0)
    expect(shipped(root, 'chrome').permissions).toEqual(['sidePanel'])
    expect(about(summary, 'storage')).toEqual([
      expect.stringContaining(
        'manifest.json lists the "storage" permission under permissions, ' +
          'and chromium:permissions replaces that key in the chrome build. ' +
          'A prefixed key replaces the unprefixed one for that browser and ' +
          'does not merge with it, so this build has no "storage", but ' +
          'background.js uses chrome.storage. Nothing grants it here, so ' +
          'in the packaged build that call fails. ' +
          'Add "storage" to chromium:permissions in manifest.json.'
      )
    ])

    expect(about(summary, 'storage')[0]).not.toContain('does not declare')
  })

  it('names the prefixed key on the Firefox build too', async () => {
    const root = project(
      {permissions: ['storage'], 'firefox:permissions': ['menus']},
      STORAGE
    )
    const summary = await build(root, 'firefox')

    expect(summary.errors_count).toBe(0)
    expect(shipped(root, 'firefox').permissions).toEqual(['menus'])
    expect(about(summary, 'storage')).toEqual([
      expect.stringContaining(
        'under permissions, and firefox:permissions replaces that key in ' +
          'the firefox build.'
      )
    ])

    expect(about(summary, 'storage')[0]).toContain(
      'Add "storage" to firefox:permissions in manifest.json.'
    )
  })

  it('leaves the build the prefixed key does not reach quiet', async () => {
    const root = project(
      {permissions: ['storage'], 'chromium:permissions': ['sidePanel']},
      STORAGE
    )
    const summary = await build(root, 'firefox')

    expect(summary.errors_count).toBe(0)
    expect(shipped(root, 'firefox').permissions).toEqual(['storage'])
    expect(about(summary, 'storage')).toEqual([])
  })

  it('names the replaced key for a tab field read as well', async () => {
    const root = project(
      {permissions: ['tabs'], 'chromium:permissions': ['sidePanel']},
      TAB_FIELDS
    )
    const [warning, ...rest] = about(await build(root, 'chrome'), 'tabs')

    expect(rest).toEqual([])
    expect(warning).toContain(
      'lists the "tabs" permission under permissions, and ' +
        'chromium:permissions replaces that key in the chrome build.'
    )

    expect(warning).toContain(
      'Add "tabs" to chromium:permissions in manifest.json'
    )

    expect(warning).not.toContain('does not declare')
  })

  it('names the replaced optional list', async () => {
    const root = project(
      {
        optional_permissions: ['storage'],
        'chromium:optional_permissions': ['bookmarks']
      },
      STORAGE
    )
    const [warning] = about(await build(root, 'chrome'), 'storage')

    expect(warning).toContain(
      'under optional_permissions, and chromium:optional_permissions ' +
        'replaces that key in the chrome build.'
    )

    expect(warning).toContain(
      'Add "storage" to chromium:optional_permissions in manifest.json.'
    )
  })

  it('names the key of another browser that holds the permission', async () => {
    const root = project({'firefox:permissions': ['storage']}, STORAGE)
    const [warning] = about(await build(root, 'chrome'), 'storage')

    expect(warning).toContain(
      'manifest.json lists the "storage" permission under ' +
        'firefox:permissions, a key the chrome build does not read, but ' +
        'background.js uses chrome.storage.'
    )

    expect(warning).toContain('Add "storage" to permissions in manifest.json.')
    expect(warning).not.toContain('does not declare')
  })

  it('keeps the plain wording when no key holds the permission', async () => {
    const root = project({'chromium:permissions': ['sidePanel']}, STORAGE)

    expect(about(await build(root, 'chrome'), 'storage')).toEqual([
      expect.stringContaining(
        'manifest.json does not declare the "storage" permission, but ' +
          'background.js uses chrome.storage. Nothing grants it here, so ' +
          'in the packaged build that call fails. ' +
          'Add "storage" to permissions in manifest.json.'
      )
    ])
  })

  it('keeps the plain wording when the manifest has no prefixed list', async () => {
    const root = project({permissions: ['alarms']}, STORAGE)

    expect(about(await build(root, 'chrome'), 'storage')).toEqual([
      expect.stringContaining(
        'manifest.json does not declare the "storage" permission, but ' +
          'background.js uses chrome.storage. Nothing grants it here, so ' +
          'in the packaged build that call fails. ' +
          'Add "storage" to permissions in manifest.json.'
      )
    ])
  })
})
