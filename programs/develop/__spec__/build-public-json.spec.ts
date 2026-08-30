import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const PUBLIC_PREFIX_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-public-json-prefix-')
)
const PUBLIC_SLASH_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-public-json-slash-')
)
const IN_PROJECT_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-public-json-src-')
)

const RULESET = JSON.stringify(
  [
    {
      id: 1,
      priority: 1,
      action: {type: 'block'},
      condition: {urlFilter: 'ads.example'}
    }
  ],
  null,
  2
)
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

function writePackageJson(root: string, name: string) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0'}, null, 2)
  )
}

function writeManifest(
  root: string,
  name: string,
  rulesPath: string,
  schemaPath: string
) {
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name,
        version: '1.0.0',
        permissions: ['declarativeNetRequest', 'storage'],
        host_permissions: ['<all_urls>'],
        declarative_net_request: {
          rule_resources: [{id: 'block', enabled: true, path: rulesPath}]
        },
        storage: {managed_schema: schemaPath}
      },
      null,
      2
    )
  )
}

function writePublicJsonFixture() {
  writePackageJson(PUBLIC_PREFIX_ROOT, 'extjs-build-public-json-prefix-spec')
  fs.mkdirSync(path.join(PUBLIC_PREFIX_ROOT, 'public'), {recursive: true})
  writeManifest(
    PUBLIC_PREFIX_ROOT,
    'Build Spec, public JSON prefix',
    'public/rules.json',
    'public/schema.json'
  )
  fs.writeFileSync(
    path.join(PUBLIC_PREFIX_ROOT, 'public', 'rules.json'),
    RULESET
  )
  fs.writeFileSync(
    path.join(PUBLIC_PREFIX_ROOT, 'public', 'schema.json'),
    SCHEMA
  )
}

function writePublicSlashFixture() {
  writePackageJson(PUBLIC_SLASH_ROOT, 'extjs-build-public-json-slash-spec')
  fs.mkdirSync(path.join(PUBLIC_SLASH_ROOT, 'public'), {recursive: true})
  writeManifest(
    PUBLIC_SLASH_ROOT,
    'Build Spec, public JSON leading slash',
    '/rules.json',
    '/schema.json'
  )
  fs.writeFileSync(
    path.join(PUBLIC_SLASH_ROOT, 'public', 'rules.json'),
    RULESET
  )
  fs.writeFileSync(
    path.join(PUBLIC_SLASH_ROOT, 'public', 'schema.json'),
    SCHEMA
  )
}

function writeInProjectFixture() {
  writePackageJson(IN_PROJECT_ROOT, 'extjs-build-public-json-src-spec')
  fs.mkdirSync(path.join(IN_PROJECT_ROOT, 'src'), {recursive: true})
  writeManifest(
    IN_PROJECT_ROOT,
    'Build Spec, in-project JSON',
    'src/rules.json',
    'src/schema.json'
  )
  fs.writeFileSync(path.join(IN_PROJECT_ROOT, 'src', 'rules.json'), RULESET)
  fs.writeFileSync(path.join(IN_PROJECT_ROOT, 'src', 'schema.json'), SCHEMA)
}

async function buildFixture(root: string) {
  const {extensionBuild} = await import('../command-build')

  const previousVitest = process.env.VITEST
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
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

function readDist(root: string) {
  const distDir = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  return {distDir, manifest}
}

beforeAll(() => {
  writePublicJsonFixture()
  writePublicSlashFixture()
  writeInProjectFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(PUBLIC_PREFIX_ROOT, {recursive: true, force: true})
  fs.rmSync(PUBLIC_SLASH_ROOT, {recursive: true, force: true})
  fs.rmSync(IN_PROJECT_ROOT, {recursive: true, force: true})
})

describe('build: public JSON references (real rspack)', () => {
  it('points the dist manifest at public JSON shipped at the output root (public/ spelling)', async () => {
    const summary = await buildFixture(PUBLIC_PREFIX_ROOT)
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readDist(PUBLIC_PREFIX_ROOT)

    expect(manifest.declarative_net_request.rule_resources[0].path).toBe(
      'rules.json'
    )
    expect(manifest.storage.managed_schema).toBe('schema.json')
    expect(fs.existsSync(path.join(distDir, 'rules.json'))).toBe(true)
    expect(fs.existsSync(path.join(distDir, 'schema.json'))).toBe(true)
    expect(
      fs.existsSync(path.join(distDir, 'declarative_net_request', 'block.json'))
    ).toBe(false)
    expect(
      fs.existsSync(path.join(distDir, 'storage', 'managed_schema.json'))
    ).toBe(false)
  }, 120_000)

  it('points the dist manifest at public JSON shipped at the output root (leading-slash spelling)', async () => {
    const summary = await buildFixture(PUBLIC_SLASH_ROOT)
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readDist(PUBLIC_SLASH_ROOT)

    expect(manifest.declarative_net_request.rule_resources[0].path).toBe(
      'rules.json'
    )
    expect(manifest.storage.managed_schema).toBe('schema.json')
    expect(fs.existsSync(path.join(distDir, 'rules.json'))).toBe(true)
    expect(fs.existsSync(path.join(distDir, 'schema.json'))).toBe(true)
    expect(
      fs.existsSync(path.join(distDir, 'declarative_net_request', 'block.json'))
    ).toBe(false)
    expect(
      fs.existsSync(path.join(distDir, 'storage', 'managed_schema.json'))
    ).toBe(false)
  }, 120_000)

  it('still emits in-project JSON to the canonical feature paths', async () => {
    const summary = await buildFixture(IN_PROJECT_ROOT)
    expect(summary.errors_count).toBe(0)

    const {distDir, manifest} = readDist(IN_PROJECT_ROOT)

    expect(manifest.declarative_net_request.rule_resources[0].path).toBe(
      'declarative_net_request/block.json'
    )
    expect(manifest.storage.managed_schema).toBe('storage/managed_schema.json')
    expect(
      fs.existsSync(path.join(distDir, 'declarative_net_request', 'block.json'))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(distDir, 'storage', 'managed_schema.json'))
    ).toBe(true)
  }, 120_000)
})
