import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// One axis decides dev instrumentation: the command. `extension build` in
// development mode is a shippable artifact whose manifest is the author's
// and whose zip carries no reload client and no maps; `extension dev` is
// the session that gets the dev CSP, the injected permissions, the reload
// client and the maps. Both browsers, both manifest versions.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const AUTHORED_CSP = "script-src 'self'; object-src 'self'"

function project(manifestVersion: 2 | 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-shippable-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'ship', version: '0.0.0'})
  )
  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("cs")\n')
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: manifestVersion,
      name: 'ship',
      version: '1.0.0',
      permissions: ['alarms'],
      ...(manifestVersion === 3
        ? {
            background: {service_worker: 'background.js'},
            content_security_policy: {extension_pages: AUTHORED_CSP}
          }
        : {
            background: {scripts: ['background.js']},
            content_security_policy: AUTHORED_CSP
          }),
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content.js']}
      ],
      ...(manifestVersion === 2
        ? {browser_specific_settings: {gecko: {id: 'ship@example.com'}}}
        : {})
    })
  )
  return root
}

async function build(
  root: string,
  browser: 'chrome' | 'firefox',
  mode: 'development' | 'production',
  metadataCommand?: 'dev' | 'build'
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode,
      zip: true,
      exitOnError: false,
      ...(metadataCommand ? {metadataCommand} : {})
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', browser)
  const files = fs.readdirSync(distDir, {recursive: true}).map(String)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const code = files
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
    .join('\n')
  // The zip may land beside the dist folder rather than inside it.
  const zips = fs
    .readdirSync(root, {recursive: true})
    .map(String)
    .filter((file) => file.endsWith('.zip') && !file.includes('node_modules'))
  const zipEntries = zips.length ? listZipEntries(path.join(root, zips[0])) : []
  return {files, manifest, code, zipEntries, zips}
}

// Zip central directory file names, enough to know what shipped.
function listZipEntries(zipPath: string): string[] {
  const buffer = fs.readFileSync(zipPath)
  const names: string[] = []
  let offset = 0
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset++
      continue
    }
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return names
}

const csp = (manifest: {content_security_policy?: unknown}) => {
  const policy = manifest.content_security_policy
  return typeof policy === 'string'
    ? policy
    : (policy as {extension_pages?: string})?.extension_pages
}

describe('the artifact and its manifest agree across command, mode, browser and manifest version', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    for (const manifestVersion of [2, 3] as const) {
      for (const mode of ['development', 'production'] as const) {
        it(`build --mode ${mode} on ${browser} MV${manifestVersion} is shippable`, async () => {
          const built = await build(project(manifestVersion), browser, mode)
          expect(csp(built.manifest)).toBe(AUTHORED_CSP)
          expect(built.manifest.permissions).toEqual(['alarms'])
          expect(built.manifest.host_permissions).toBeUndefined()
          expect(built.code).not.toMatch(
            /__extjsBridgeProducerInstalled|__extjsScriptsReplay|webpackHotUpdate/
          )
          expect(built.zips, built.files.join(',')).not.toEqual([])
          expect(built.zipEntries.length).toBeGreaterThan(0)
          expect(built.zipEntries.some((entry) => entry.endsWith('.map'))).toBe(
            false
          )
        }, 180_000)
      }
    }
  }

  it('a dev session keeps the dev CSP, the injected permissions, the reload client and the maps', async () => {
    const built = await build(project(3), 'chrome', 'development', 'dev')
    expect(csp(built.manifest)).not.toBe(AUTHORED_CSP)
    expect(built.manifest.permissions).toEqual(
      expect.arrayContaining([
        'alarms',
        'scripting',
        'tabs',
        'management',
        'storage'
      ])
    )
    expect(built.manifest.host_permissions).toEqual(['https://example.com/*'])
    expect(built.code).toMatch(/__extjsScriptsReplay/)
    expect(built.files.some((file) => file.endsWith('.map'))).toBe(true)
  }, 180_000)
})
