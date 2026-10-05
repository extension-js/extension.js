import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  files: Record<string, string>,
  manifest: Record<string, unknown> = {
    manifest_version: 3,
    background: {service_worker: 'background.js'}
  }
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-build-constant-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'constant', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'constant', version: '1.0.0', ...manifest})
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox' = 'chrome') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function constantWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.includes('nothing defines it')
  )
}

describe('a background entry that reads a constant nothing defines', () => {
  it('warns with the file and the name while the build stays green', async () => {
    const root = project({
      'background.js': [
        "console.log('worker start', RELEASE_TAG)",
        'if (__IS_CHROME__) {',
        "  chrome.runtime.onInstalled.addListener(() => console.log('installed'))",
        '}',
        ''
      ].join('\n')
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const warnings = constantWarnings(summary)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('background.js reads RELEASE_TAG')
    expect(warnings[0]).toContain('"RELEASE_TAG is not defined"')
    expect(warnings[0]).toContain('define: {RELEASE_TAG: value}')
    expect(warnings[1]).toContain('background.js reads __IS_CHROME__')
  }, 120_000)

  it('stays quiet once the constant is defined', async () => {
    const root = project({
      'background.js': "console.log('worker start', RELEASE_TAG)\n",
      'extension.config.js': "module.exports = {define: {RELEASE_TAG: 'v1'}}\n"
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(constantWarnings(summary)).toEqual([])
  }, 120_000)

  it('stays quiet for a guarded, declared, lazy or platform read', async () => {
    const root = project({
      'background.js': [
        "const FALLBACK_TAG = 'dev'",
        "const tag = typeof RELEASE_TAG === 'undefined' ? FALLBACK_TAG : RELEASE_TAG",
        'const parsed = JSON.parse(\'{"a":1}\')',
        "const url = new URL('https://example.com')",
        'chrome.runtime.onInstalled.addListener(() => {',
        '  console.log(tag, parsed, url, LISTENER_ONLY_TAG)',
        '})',
        "if (self.FEATURE_FLAG) console.log('on')",
        ''
      ].join('\n')
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(constantWarnings(summary)).toEqual([])
  }, 120_000)

  it('sees a constant a sibling background script declares', async () => {
    const root = project(
      {
        'constants.js': "var SHARED_TAG = 'v1'\n",
        'background.js': "console.log('bg', SHARED_TAG, MISSING_TAG)\n"
      },
      {
        manifest_version: 2,
        background: {scripts: ['constants.js', 'background.js']}
      }
    )

    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)

    const warnings = constantWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('background.js reads MISSING_TAG')
    expect(warnings[0]).not.toContain('SHARED_TAG')
  }, 120_000)
})
