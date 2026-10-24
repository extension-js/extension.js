import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(matches: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-loopback-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'loopback', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'loopback',
      version: '1.0.0',
      content_scripts: [{matches, js: ['content.js']}]
    })
  )

  fs.writeFileSync(path.join(root, 'content.js'), 'console.log(1)\n')

  return root
}

async function build(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

const loopbackWarnings = (summary: {warnings?: string[]}) =>
  (summary.warnings || []).filter((text) =>
    text.startsWith('E_PROD_LOOPBACK_ORIGIN:')
  )

describe('a production build that reaches the local machine', () => {
  it('ships the match as written and warns with a code naming where it sits', async () => {
    const root = project(['https://example.com/*', 'http://localhost:4322/*'])
    const summary = await build(root, 'production')

    expect(summary.errors_count).toBe(0)
    const warnings = loopbackWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'http://localhost:4322/* in content_scripts[0].matches'
    )

    expect(warnings[0]).toContain('.env.development')

    const shipped = JSON.parse(
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'manifest.json'),
        'utf-8'
      )
    )
    expect(shipped.content_scripts[0].matches).toContain(
      'http://localhost:4322/*'
    )
  })

  it('stays quiet for a clean production manifest', async () => {
    const summary = await build(
      project(['https://example.com/*']),
      'production'
    )

    expect(summary.errors_count).toBe(0)
    expect(loopbackWarnings(summary)).toEqual([])
  })

  it('stays quiet for a development build', async () => {
    const summary = await build(
      project(['http://localhost:4322/*']),
      'development'
    )

    expect(loopbackWarnings(summary)).toEqual([])
  })
})
