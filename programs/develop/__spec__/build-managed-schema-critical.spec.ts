import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Chrome refuses a storage.managed_schema it cannot parse or that is not an
// object, so the build must fail the same way it does for a broken DNR
// ruleset instead of copying the broken file into dist.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(schema: string, spelling = 'schema.json') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-managed-schema-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'schema', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Schema',
      version: '1.0.0',
      permissions: ['storage'],
      storage: {managed_schema: spelling}
    })
  )
  const abs = path.join(root, spelling.replace(/^\//, 'public/'))
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, schema)
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

describe('storage.managed_schema is critical JSON', () => {
  it('fails the build on a schema that is not valid JSON', async () => {
    const root = project('{ this is not valid json ')
    await expect(build(root)).rejects.toThrow('Build failed with errors')
    expect(fs.existsSync(path.join(root, 'dist', 'chrome', 'storage'))).toBe(
      false
    )
  }, 120_000)

  it('fails the build on a schema that is not an object', async () => {
    await expect(build(project('[]'))).rejects.toThrow(
      'Build failed with errors'
    )
  }, 120_000)

  it('fails the same way for a schema public/ owns', async () => {
    await expect(build(project('[]', '/schema.json'))).rejects.toThrow(
      'Build failed with errors'
    )
  }, 120_000)

  it('ships a valid schema at the path the manifest names', async () => {
    const root = project('{"type":"object","properties":{}}')
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    const distDir = path.join(root, 'dist', 'chrome')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )
    expect(
      fs.existsSync(path.join(distDir, manifest.storage.managed_schema))
    ).toBe(true)
  }, 120_000)
})
