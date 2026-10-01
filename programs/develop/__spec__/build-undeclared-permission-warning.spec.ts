import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(permissions: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-undeclared-perm-'))
  roots.push(root)

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
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
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

  it('stays quiet once tabs is declared', async () => {
    const summary = await build(project(['tabs']))

    expect(summary.errors_count).toBe(0)
    expect(permissionWarnings(summary)).toEqual([])
  })
})
