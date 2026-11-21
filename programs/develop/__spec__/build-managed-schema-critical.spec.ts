import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// Chrome refuses a storage.managed_schema it cannot parse or that is not an
// object, so the build must fail the same way it does for a broken DNR
// ruleset instead of copying the broken file into dist.
const tempFolder = trackTempFolders()

function project(schema: string, spelling = 'schema.json') {
  const root = tempFolder('extjs-managed-schema-')
  writeExtensionProject(root, {
    manifest: {
      name: 'Schema',
      permissions: ['storage'],
      storage: {managed_schema: spelling}
    },
    packageJson: {name: 'schema'}
  })

  const abs = path.join(root, spelling.replace(/^\//, 'public/'))
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, schema)

  return root
}

async function build(root: string) {
  return buildProject(root, {
    mode: 'production'
  })
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
