import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// One source manifest serves MV3 on Chromium and MV2 on Firefox through the
// prefixed manifest_version. Firefox MV2 has no host_permissions, so the
// built manifest carries the match patterns under permissions instead, in
// production and in development alike, while the MV3 output stays as written.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const HOSTS = ['<all_urls>', 'https://api.example.com/*']
const OPTIONAL_HOSTS = ['https://opt.example.com/*']

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-mv2-hosts-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'hosts', version: '0.0.0'})
  )
  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("hosts")\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'hosts',
      version: '1.0.0',
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      browser_specific_settings: {gecko: {id: 'hosts@example.com'}},
      permissions: ['storage'],
      host_permissions: HOSTS,
      optional_permissions: ['tabs'],
      optional_host_permissions: OPTIONAL_HOSTS,
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content.js']}
      ]
    })
  )
  return root
}

async function build(
  root: string,
  browser: 'chrome' | 'firefox',
  mode: 'production' | 'development'
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    // Only a dev session (named by its command) takes the dev host grants,
    // a plain development-mode build stays shippable.
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode,
      ...(mode === 'development' ? {metadataCommand: 'dev'} : {}),
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  return JSON.parse(
    fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
  )
}

describe('host_permissions on a Firefox MV2 build', () => {
  it('production: folds the hosts into permissions and drops the MV3 keys', async () => {
    const manifest = await build(project(), 'firefox', 'production')

    expect(manifest.manifest_version).toBe(2)
    expect(manifest).not.toHaveProperty('host_permissions')
    expect(manifest).not.toHaveProperty('optional_host_permissions')
    expect(manifest.permissions).toEqual(['storage', ...HOSTS])
    expect(manifest.optional_permissions).toEqual(['tabs', ...OPTIONAL_HOSTS])
  }, 180_000)

  it('development: the dev host grants land in the same permissions list', async () => {
    const manifest = await build(project(), 'firefox', 'development')

    expect(manifest.manifest_version).toBe(2)
    expect(manifest).not.toHaveProperty('host_permissions')
    expect(manifest).not.toHaveProperty('optional_host_permissions')
    for (const host of [...HOSTS, 'https://example.com/*', 'storage']) {
      expect(manifest.permissions).toContain(host)
    }
    expect(manifest.optional_permissions).toEqual(['tabs', ...OPTIONAL_HOSTS])
  }, 180_000)

  it('leaves the Chromium MV3 output as written', async () => {
    const manifest = await build(project(), 'chrome', 'production')

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['storage'])
    expect(manifest.host_permissions).toEqual(HOSTS)
    expect(manifest.optional_permissions).toEqual(['tabs'])
    expect(manifest.optional_host_permissions).toEqual(OPTIONAL_HOSTS)
  }, 180_000)
})
