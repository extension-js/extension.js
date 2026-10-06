import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const SUITE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-war-sibling-geturl-')
)

const MATCHES = 'https://sibling-geturl.example/*'
const IMAGE_BYTES = Buffer.concat([
  Buffer.from('war-sibling-geturl-png-'),
  Buffer.alloc(4 * 1024, 7)
])

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(name: string): string {
  const root = path.join(SUITE_ROOT, name)
  fs.mkdirSync(root, {recursive: true})

  write(root, 'shared/sibling-picture.png', IMAGE_BYTES)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: `extjs-build-war-sibling-geturl-${name}`,
      version: '0.0.0'
    })
  )

  write(
    root,
    'src/manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: `Build Spec, WAR sibling getURL ${name}`,
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      web_accessible_resources: [
        {resources: ['../shared/sibling-picture.png'], matches: [MATCHES]}
      ]
    })
  )

  write(
    root,
    'src/background.js',
    "console.log(chrome.runtime.getURL('shared/sibling-picture.png'))\n"
  )

  return root
}

async function buildFixture(root: string) {
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

function declaredResources(distDir: string) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  ) as {
    web_accessible_resources?: Array<{resources: string[]}>
  }

  return (manifest.web_accessible_resources || []).flatMap(
    (group) => group.resources
  )
}

afterAll(() => {
  fs.rmSync(SUITE_ROOT, {recursive: true, force: true})
})

describe('build: a runtime.getURL literal naming a web_accessible_resources file beside a src manifest', () => {
  it('ships the file at the literal path without a missing-file warning', async () => {
    const root = writeFixture('geturl')
    const summary = await buildFixture(root)

    expect(summary.errors_count).toBe(0)
    expect(summary.warnings_count).toBe(0)
    expect(
      (summary.warnings || []).filter((line) => /getURL/.test(line))
    ).toEqual([])

    const distDir = path.join(root, 'dist', 'chrome')
    const literal = path.join(distDir, 'shared/sibling-picture.png')

    expect(fs.existsSync(literal)).toBe(true)
    expect(fs.readFileSync(literal)).toEqual(IMAGE_BYTES)
    expect(declaredResources(distDir)).toContain('shared/sibling-picture.png')
  }, 120_000)
})
