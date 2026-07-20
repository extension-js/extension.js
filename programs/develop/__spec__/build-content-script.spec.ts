import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const FIXTURE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-content-script-')
)

function writeFixture() {
  fs.mkdirSync(path.join(FIXTURE_ROOT, 'src', 'content'), {recursive: true})

  fs.writeFileSync(
    path.join(FIXTURE_ROOT, 'package.json'),
    JSON.stringify(
      {
        private: true,
        name: 'extjs-build-content-script-spec',
        version: '0.0.0',
        type: 'module'
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(FIXTURE_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, Content Script',
        version: '1.0.0',
        content_scripts: [
          {
            matches: ['https://example.com/*'],
            js: ['src/content/scripts.js'],
            run_at: 'document_idle'
          }
        ]
      },
      null,
      2
    )
  )

  fs.writeFileSync(
    path.join(FIXTURE_ROOT, 'src', 'content', 'scripts.js'),
    [
      'export default function main() {',
      "  const host = document.createElement('div')",
      "  host.id = 'extjs-build-spec-content-root'",
      '  document.documentElement.append(host)',
      '  return () => host.remove()',
      '}',
      ''
    ].join('\n')
  )
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, {recursive: true, force: true})
})

describe('build: content script (real rspack)', () => {
  it('compiles the user extension without the node:module / web-target leak', async () => {
    const {extensionBuild} = await import('../command-build')

    const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
    const previousVitest = process.env.VITEST
    process.env.VITEST = 'true'
    delete process.env.EXTENSION_AUTHOR_MODE

    try {
      const summary = await extensionBuild(FIXTURE_ROOT, {
        browser: 'chrome',
        silent: true,
        install: false,
        mode: 'development',
        exitOnError: false
      } as any)

      expect(summary.errors_count).toBe(0)
      expect(summary.total_assets).toBeGreaterThan(0)
    } finally {
      if (previousAuthorMode === undefined) {
        delete process.env.EXTENSION_AUTHOR_MODE
      } else {
        process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
      }
      if (previousVitest === undefined) {
        delete process.env.VITEST
      } else {
        process.env.VITEST = previousVitest
      }
    }

    const distDir = path.join(FIXTURE_ROOT, 'dist', 'chrome')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )
    const contentJs: string[] = manifest.content_scripts?.[0]?.js ?? []
    expect(contentJs.length).toBeGreaterThan(0)
    for (const rel of contentJs) {
      expect(
        fs.existsSync(path.join(distDir, rel)),
        `${rel} declared by manifest but missing from ${distDir}`
      ).toBe(true)
    }
  }, 120_000)
})
