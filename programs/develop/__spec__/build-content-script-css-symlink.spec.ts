import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// rspack hands rules the symlink-resolved path of every module. The project
// here is reached through a symlink on purpose (macOS adds one more, its
// tmpdir), so the content-script stylesheet rule only matches when the
// issuer index canonicalizes the manifest's script paths the same way.
const REAL_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-cs-css-symlink-real-')
)
const LINK_PARENT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-cs-css-symlink-link-')
)
const LINKED_ROOT = path.join(LINK_PARENT, 'project')

const FONT_BYTES = Buffer.from('probe-woff2-bytes')

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture(root: string) {
  write(
    root,
    'package.json',
    JSON.stringify(
      {
        private: true,
        name: 'extjs-build-cs-css-symlink',
        version: '0.0.0',
        type: 'module'
      },
      null,
      2
    )
  )
  write(
    root,
    'manifest.json',
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, content-script css through a symlink',
        version: '1.0.0',
        background: {service_worker: 'src/background.js'},
        content_scripts: [
          {matches: ['https://fonts.example/*'], js: ['src/content.js']}
        ]
      },
      null,
      2
    )
  )
  write(root, 'src/content.js', "import './styles.css'\n")
  write(root, 'src/background.js', "console.log('bg')\n")
  write(
    root,
    'src/styles.css',
    [
      '@font-face {',
      '  font-family: "Probe";',
      '  src: url(./fonts/probe.woff2) format("woff2");',
      '}',
      ''
    ].join('\n')
  )
  write(root, 'src/fonts/probe.woff2', FONT_BYTES)
}

async function buildThrough(root: string) {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
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
}

afterAll(() => {
  fs.rmSync(LINK_PARENT, {recursive: true, force: true})
  fs.rmSync(REAL_ROOT, {recursive: true, force: true})
})

describe('build: a content-script stylesheet under a symlinked project path (real rspack)', () => {
  it('goes through the content-script rule: a runtime stylesheet module, not an html css chunk', async () => {
    writeFixture(REAL_ROOT)
    fs.symlinkSync(REAL_ROOT, LINKED_ROOT, 'dir')
    expect(fs.realpathSync(LINKED_ROOT)).not.toBe(LINKED_ROOT)

    const summary = await buildThrough(LINKED_ROOT)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(LINKED_ROOT, 'dist', 'chrome')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ) as {
      content_scripts?: Array<{js?: string[]; css?: string[]}>
      web_accessible_resources?: Array<{resources: string[]}>
    }
    const script = manifest.content_scripts?.[0]
    const source = fs.readFileSync(
      path.join(distDir, String(script?.js?.[0])),
      'utf8'
    )

    // The content-script rule inlines the sheet as a runtime module that
    // names the extension root. The html rule would have emitted a css
    // chunk instead and left the url() host-relative.
    expect(source).toContain('data:text/css;charset=utf-8,')
    // Manifest-relative, not a path that climbed out through the symlink.
    expect(source).toContain(
      'url("__EXTENSIONJS_EXTENSION_ROOT__/assets/src/fonts/probe.woff2")'
    )
    expect(source).not.toMatch(/url\(\s*(?:\\?["'])?\.\//)
    expect(script?.css || []).toEqual([])
    const chunks = fs
      .readdirSync(path.join(distDir, 'content_scripts'))
      .filter((entry) => entry.endsWith('.css'))
    expect(chunks).toEqual([])

    expect(
      fs.readFileSync(path.join(distDir, 'assets/src/fonts/probe.woff2'))
    ).toEqual(FONT_BYTES)
    const resources = (manifest.web_accessible_resources || []).flatMap(
      (group) => group.resources || []
    )
    expect(resources).toContain('assets/src/fonts/probe.woff2')
  }, 120_000)
})
