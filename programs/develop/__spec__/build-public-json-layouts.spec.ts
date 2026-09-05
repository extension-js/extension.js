import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Manifest JSON resources (a DNR ruleset, a managed schema) kept under the
// public folder the copier ships: the root public/ and the next-to-manifest
// src/public/ layout must both build, land at the output root, and keep the
// built manifest pointing at the copied file.

const roots: string[] = []

type Layout = 'root' | 'src'
type Spelling = 'prefix' | 'slash'

function ruleset(urlFilter: string) {
  return JSON.stringify(
    [
      {
        id: 1,
        priority: 1,
        action: {type: 'block'},
        condition: {urlFilter}
      }
    ],
    null,
    2
  )
}

const SCHEMA = JSON.stringify(
  {
    type: 'object',
    properties: {
      blocked: {type: 'boolean'}
    }
  },
  null,
  2
)

function ref(spelling: Spelling, file: string) {
  return spelling === 'prefix' ? `public/${file}` : `/${file}`
}

function project(options: {
  layout: Layout
  spelling: Spelling
  manifestVersion?: 2 | 3
  schema?: string
  // Also write a root public/ beside the src/public/ one, to prove precedence.
  shadowingRootPublic?: boolean
}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-build-public-json-layouts-')
  )
  roots.push(root)
  const manifestDir = options.layout === 'src' ? path.join(root, 'src') : root
  const publicDir = path.join(manifestDir, 'public')
  fs.mkdirSync(publicDir, {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'public-json-layouts',
      version: '0.0.0'
    })
  )
  fs.writeFileSync(path.join(publicDir, 'rules.json'), ruleset('src.example'))
  fs.writeFileSync(
    path.join(publicDir, 'schema.json'),
    options.schema ?? SCHEMA
  )
  if (options.shadowingRootPublic) {
    fs.mkdirSync(path.join(root, 'public'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'public', 'rules.json'),
      ruleset('root.example')
    )
    fs.writeFileSync(path.join(root, 'public', 'schema.json'), SCHEMA)
  }

  const manifestVersion = options.manifestVersion ?? 3
  const manifest: Record<string, unknown> = {
    manifest_version: manifestVersion,
    name: 'public-json-layouts',
    version: '1.0.0',
    permissions: ['storage'],
    storage: {managed_schema: ref(options.spelling, 'schema.json')}
  }
  if (manifestVersion === 3) {
    manifest.permissions = ['declarativeNetRequest', 'storage']
    manifest.host_permissions = ['<all_urls>']
    manifest.declarative_net_request = {
      rule_resources: [
        {id: 'block', enabled: true, path: ref(options.spelling, 'rules.json')}
      ]
    }
  }
  fs.writeFileSync(
    path.join(manifestDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )
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

function readDist(root: string, browser: 'chrome' | 'firefox' = 'chrome') {
  const distDir = path.join(root, 'dist', browser)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  return {distDir, manifest}
}

function expectShippedAtOutputRoot(root: string) {
  const {distDir, manifest} = readDist(root)
  const rulesPath = manifest.declarative_net_request.rule_resources[0].path
  const schemaPath = manifest.storage.managed_schema
  expect(rulesPath).toBe('rules.json')
  expect(schemaPath).toBe('schema.json')
  expect(fs.existsSync(path.join(distDir, rulesPath))).toBe(true)
  expect(fs.existsSync(path.join(distDir, schemaPath))).toBe(true)
  // The copier ships the file once, feature-json must not emit a second copy.
  expect(
    fs.existsSync(path.join(distDir, 'declarative_net_request', 'block.json'))
  ).toBe(false)
  expect(
    fs.existsSync(path.join(distDir, 'storage', 'managed_schema.json'))
  ).toBe(false)
  return {distDir, manifest}
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

describe('build: manifest JSON resources under the shipped public folder', () => {
  it('root public/, public/ prefix spelling: ships at the output root', async () => {
    const root = project({layout: 'root', spelling: 'prefix'})
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expectShippedAtOutputRoot(root)
  }, 120_000)

  it('src/public/ beside src/manifest.json, public/ prefix spelling: ships at the output root', async () => {
    const root = project({layout: 'src', spelling: 'prefix'})
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expectShippedAtOutputRoot(root)
  }, 120_000)

  it('src/public/ beside src/manifest.json, leading-slash spelling: ships at the output root', async () => {
    const root = project({layout: 'src', spelling: 'slash'})
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expectShippedAtOutputRoot(root)
  }, 120_000)

  it('keeps the root public/ precedence when both folders exist', async () => {
    const root = project({
      layout: 'src',
      spelling: 'slash',
      shadowingRootPublic: true
    })
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    const {distDir} = expectShippedAtOutputRoot(root)
    const shipped = JSON.parse(
      fs.readFileSync(path.join(distDir, 'rules.json'), 'utf8')
    )
    expect(shipped[0].condition.urlFilter).toBe('root.example')
  }, 120_000)

  it('firefox MV2 managed_schema under src/public/: ships at the output root', async () => {
    const root = project({layout: 'src', spelling: 'slash', manifestVersion: 2})
    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)
    const {distDir, manifest} = readDist(root, 'firefox')
    expect(manifest.storage.managed_schema).toBe('schema.json')
    expect(
      fs.existsSync(path.join(distDir, manifest.storage.managed_schema))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(distDir, 'storage', 'managed_schema.json'))
    ).toBe(false)
  }, 120_000)

  it('a broken managed schema under src/public/ still fails the build', async () => {
    const root = project({
      layout: 'src',
      spelling: 'slash',
      schema: '{"type": '
    })
    await expect(build(root)).rejects.toThrow('Build failed with errors')
  }, 120_000)
})
