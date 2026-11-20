import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'

// One source manifest serves MV3 on Chromium and MV2 on Firefox through the
// prefixed manifest_version. Firefox MV2 reads content_security_policy as one
// string, so the built manifest carries the extension_pages policy as that
// string, in production and in a dev session alike, while the MV3 output
// keeps the object as written.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const PAGES = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-mv2-csp-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'csp', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("csp")\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'csp',
      version: '1.0.0',
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      browser_specific_settings: {gecko: {id: 'csp@example.com'}},
      content_security_policy: {extension_pages: PAGES},
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
  // Only a dev session (named by its command) takes the dev CSP, a plain
  // development-mode build stays shippable.
  const summary = await buildProject(root, {
    browser,
    mode,
    ...(mode === 'development' ? {metadataCommand: 'dev'} : {})
  })
  expect(summary.errors_count).toBe(0)

  return JSON.parse(
    fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
  )
}

describe('content_security_policy on a Firefox MV2 build', () => {
  it('production: writes the extension_pages policy as the MV2 string', async () => {
    const manifest = await build(project(), 'firefox', 'production')

    expect(manifest.manifest_version).toBe(2)
    expect(manifest.content_security_policy).toBe(PAGES)
  }, 180_000)

  it('development: the loosened dev policy is still one string', async () => {
    const manifest = await build(project(), 'firefox', 'development')

    expect(manifest.manifest_version).toBe(2)
    expect(typeof manifest.content_security_policy).toBe('string')
    expect(manifest.content_security_policy).toContain("'wasm-unsafe-eval'")
    expect(manifest.content_security_policy).toContain("'unsafe-eval'")
    expect(manifest.content_security_policy).toContain('blob:')
  }, 180_000)

  it('leaves the Chromium MV3 object as written in production', async () => {
    const manifest = await build(project(), 'chrome', 'production')

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.content_security_policy).toEqual({extension_pages: PAGES})
  }, 180_000)

  it('keeps the Chromium MV3 object form in a dev session', async () => {
    const manifest = await build(project(), 'chrome', 'development')

    expect(manifest.manifest_version).toBe(3)
    expect(typeof manifest.content_security_policy).toBe('object')
    expect(manifest.content_security_policy.extension_pages).toContain(
      "'wasm-unsafe-eval'"
    )
  }, 180_000)
})
