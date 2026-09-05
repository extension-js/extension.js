import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The plain spelling of a manifest JSON resource (`rules.json`, no leading
// slash, no public/ prefix) whose file lives only under the shipped public
// folder: the copier lands it at the output root, so the built manifest must
// name that copy instead of the compiled slot nothing emits. A file that
// exists beside the manifest keeps its compiled slot.

const roots: string[] = []

type Layout = 'root' | 'src'
type Browser = 'chrome' | 'firefox'

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

function project(options: {
  layout: Layout
  manifestVersion?: 2 | 3
  // Where the JSON files live: the shipped public folder, or beside the manifest.
  home: 'public' | 'manifest'
  // Also write a root public/ beside the src/public/ one, to prove precedence.
  shadowingRootPublic?: boolean
}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-build-public-json-plain-')
  )
  roots.push(root)
  const manifestDir = options.layout === 'src' ? path.join(root, 'src') : root
  const home =
    options.home === 'public' ? path.join(manifestDir, 'public') : manifestDir
  fs.mkdirSync(home, {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'public-json-plain-spelling',
      version: '0.0.0'
    })
  )
  fs.writeFileSync(path.join(home, 'rules.json'), ruleset('src.example'))
  fs.writeFileSync(path.join(home, 'schema.json'), SCHEMA)
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
    name: 'public-json-plain-spelling',
    version: '1.0.0',
    permissions: ['storage'],
    storage: {managed_schema: 'schema.json'}
  }
  if (manifestVersion === 3) {
    manifest.permissions = ['declarativeNetRequest', 'storage']
    manifest.host_permissions = ['<all_urls>']
    manifest.declarative_net_request = {
      rule_resources: [{id: 'block', enabled: true, path: 'rules.json'}]
    }
  }
  fs.writeFileSync(
    path.join(manifestDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )
  return root
}

async function build(root: string, browser: Browser = 'chrome') {
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

function readDist(root: string, browser: Browser = 'chrome') {
  const distDir = path.join(root, 'dist', browser)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  return {distDir, manifest}
}

// Every path the built manifest names must be a file in dist, whichever
// slot the build chose for it.
function expectNamedPathsExist(distDir: string, manifest: any) {
  const named: string[] = [manifest.storage.managed_schema]
  if (manifest.declarative_net_request) {
    for (const entry of manifest.declarative_net_request.rule_resources) {
      named.push(entry.path)
    }
  }
  for (const rel of named) {
    expect(rel, 'manifest names a relative path').not.toMatch(/^\//)
    expect(
      fs.existsSync(path.join(distDir, rel)),
      `${rel} named by the built manifest exists in dist`
    ).toBe(true)
  }
}

function expectShippedAtOutputRoot(root: string, browser: Browser = 'chrome') {
  const {distDir, manifest} = readDist(root, browser)
  expect(manifest.storage.managed_schema).toBe('schema.json')
  if (browser === 'chrome') {
    expect(manifest.declarative_net_request.rule_resources[0].path).toBe(
      'rules.json'
    )
  }
  expectNamedPathsExist(distDir, manifest)
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

describe('build: plain-spelled manifest JSON resources that public/ owns', () => {
  it('root public/, chrome MV3: names the copied file at the output root', async () => {
    const root = project({layout: 'root', home: 'public'})
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expectShippedAtOutputRoot(root)
  }, 120_000)

  it('src/public/ beside src/manifest.json, chrome MV3: names the copied file at the output root', async () => {
    const root = project({layout: 'src', home: 'public'})
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expectShippedAtOutputRoot(root)
  }, 120_000)

  it('keeps the root public/ precedence when both folders exist', async () => {
    const root = project({
      layout: 'src',
      home: 'public',
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

  it('firefox MV2 managed_schema under src/public/: names the copied file at the output root', async () => {
    const root = project({layout: 'src', home: 'public', manifestVersion: 2})
    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)
    expectShippedAtOutputRoot(root, 'firefox')
  }, 120_000)

  it('an in-project rules.json beside the manifest keeps its compiled slot', async () => {
    const root = project({layout: 'src', home: 'manifest'})
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    const {distDir, manifest} = readDist(root)
    expect(manifest.declarative_net_request.rule_resources[0].path).toBe(
      'declarative_net_request/block.json'
    )
    expect(manifest.storage.managed_schema).toBe('storage/managed_schema.json')
    expectNamedPathsExist(distDir, manifest)
    expect(fs.existsSync(path.join(distDir, 'rules.json'))).toBe(false)
    expect(fs.existsSync(path.join(distDir, 'schema.json'))).toBe(false)
  }, 120_000)
})
