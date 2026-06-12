// Golden-fixture gate for the manifest output contract: one real rspack
// build over a fixture that touches every path-rewriting surface, with the
// emitted manifest pinned field by field. @extension.dev/compiler ports this
// contract for in-browser previews (its parity scoreboard pins the same
// shapes), so a change that breaks these expectations silently breaks
// preview parity, not just this repo. Heavier than the unit suites (~one
// real build, same trade-off as build-content-script.spec.ts).

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const FIXTURE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-manifest-contract-')
)

function write(relPath: string, contents: string) {
  const abs = path.join(FIXTURE_ROOT, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function writeFixture() {
  write(
    'package.json',
    JSON.stringify(
      {
        private: true,
        name: 'extjs-manifest-contract-spec',
        version: '0.0.0'
      },
      null,
      2
    )
  )

  write(
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          jsx: 'react-jsx'
        },
        include: ['src']
      },
      null,
      2
    )
  )

  write(
    'manifest.json',
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Manifest Contract Fixture',
        version: '1.0.0',
        background: {service_worker: 'src/background.ts'},
        action: {
          default_popup: 'src/popup.html',
          default_icon: {'16': 'public/icons/icon16.png'}
        },
        options_ui: {page: 'src/options.html'},
        devtools_page: 'src/devtools.html',
        side_panel: {default_path: 'src/sidepanel.html'},
        chrome_url_overrides: {newtab: 'src/newtab.html'},
        icons: {'16': 'public/icons/icon16.png'},
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['src/content.ts'],
            css: ['src/content.css']
          },
          {
            matches: ['<all_urls>'],
            world: 'MAIN',
            js: ['src/main-world.ts']
          }
        ],
        web_accessible_resources: [
          {
            resources: ['public/icons/icon16.png'],
            matches: ['<all_urls>'],
            use_dynamic_url: true
          }
        ],
        permissions: ['sidePanel']
      },
      null,
      2
    )
  )

  write('src/background.ts', "console.log('bg')\nexport {}\n")
  write('src/content.ts', "console.log('content')\nexport {}\n")
  write('src/main-world.ts', "console.log('main-world')\nexport {}\n")
  write('src/content.css', 'body { outline: 1px solid red }\n')

  for (const page of ['popup', 'options', 'devtools', 'sidepanel', 'newtab']) {
    write(
      `src/${page}.html`,
      [
        '<!doctype html><html><head>',
        `<link rel="stylesheet" href="./${page}.css">`,
        '</head><body>',
        `<h1>${page}</h1>`,
        `<script type="module" src="./${page}.ts"></script>`,
        '</body></html>'
      ].join('\n')
    )
    write(`src/${page}.ts`, `console.log('${page}')\nexport {}\n`)
    write(`src/${page}.css`, 'h1 { color: blue }\n')
  }

  // Smallest valid 1x1 PNG.
  fs.mkdirSync(path.join(FIXTURE_ROOT, 'public', 'icons'), {recursive: true})
  fs.writeFileSync(
    path.join(FIXTURE_ROOT, 'public', 'icons', 'icon16.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
        'h6FO1AAAAABJRU5ErkJggg==',
      'base64'
    )
  )
}

beforeAll(() => {
  writeFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, {recursive: true, force: true})
})

describe('manifest output contract (real rspack, golden fixture)', () => {
  it('emits the documented predictable paths for every manifest surface', async () => {
    const {extensionBuild} = await import('../command-build')

    const previousVitest = process.env.VITEST
    process.env.VITEST = 'true'

    try {
      const summary = await extensionBuild(FIXTURE_ROOT, {
        browser: 'chrome',
        silent: true,
        install: false,
        exitOnError: false
      } as any)

      expect(summary.errors_count).toBe(0)
    } finally {
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

    expect(manifest.background).toEqual({
      service_worker: 'background/service_worker.js'
    })
    expect(manifest.action).toEqual({
      default_popup: 'action/index.html',
      default_icon: {'16': 'icons/icon16.png'}
    })
    expect(manifest.options_ui).toEqual({page: 'options/index.html'})
    expect(manifest.devtools_page).toBe('devtools/index.html')
    expect(manifest.side_panel).toEqual({default_path: 'sidebar/index.html'})
    expect(manifest.chrome_url_overrides).toEqual({
      newtab: 'chrome_url_overrides/newtab.html'
    })
    expect(manifest.icons).toEqual({'16': 'icons/icon16.png'})

    // Content scripts: per-index canonical names; the MAIN world script
    // keeps its index name and gains a bridge entry (no world) numbered
    // after the original count, inserted before it.
    expect(manifest.content_scripts).toEqual([
      {
        matches: ['<all_urls>'],
        js: ['content_scripts/content-0.js'],
        css: ['content_scripts/content-0.css']
      },
      {
        matches: ['<all_urls>'],
        js: ['content_scripts/content-2.js'],
        css: []
      },
      {
        matches: ['<all_urls>'],
        world: 'MAIN',
        js: ['content_scripts/content-1.js'],
        css: []
      }
    ])

    // WAR: declared resource normalized from public/, the emitted
    // content-script CSS auto-merged into the matching group, resources
    // sorted, and user fields like use_dynamic_url preserved.
    expect(manifest.web_accessible_resources).toEqual([
      {
        resources: ['content_scripts/content-0.css', 'icons/icon16.png'],
        matches: ['<all_urls>'],
        use_dynamic_url: true
      }
    ])

    // The files behind every contract path must exist on disk.
    const expectedFiles = [
      'background/service_worker.js',
      'action/index.html',
      'action/index.js',
      'action/index.css',
      'options/index.html',
      'devtools/index.html',
      'sidebar/index.html',
      'chrome_url_overrides/newtab.html',
      'content_scripts/content-0.js',
      'content_scripts/content-0.css',
      'content_scripts/content-1.js',
      'content_scripts/content-2.js',
      'icons/icon16.png'
    ]
    for (const file of expectedFiles) {
      expect(fs.existsSync(path.join(distDir, file)), file).toBe(true)
    }
  }, 120_000)
})
