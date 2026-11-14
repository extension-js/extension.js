import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The hold a production run puts on its first page lives in the launcher,
// so the build stays the author's code with no dev runtime reporting for it.

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

type Browser = 'chrome' | 'firefox'

function project(browser: Browser): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-boot-bytes-'))
  roots.push(root)

  const api = browser === 'firefox' ? 'browser' : 'chrome'
  const manifest =
    browser === 'firefox'
      ? {
          manifest_version: 2,
          background: {scripts: ['background.js']},
          permissions: ['scripting', '<all_urls>']
        }
      : {
          manifest_version: 3,
          background: {service_worker: 'background.js'},
          permissions: ['scripting'],
          host_permissions: ['<all_urls>']
        }

  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'boot-bytes', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'boot-bytes', version: '1.0.0', ...manifest})
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    `${api}.scripting.registerContentScripts([
  {id: 'iso', js: ['scripts/iso.js'], matches: ['<all_urls>'], runAt: 'document_start'},
  {id: 'main', js: ['scripts/main.js'], matches: ['<all_urls>'], runAt: 'document_start', world: 'MAIN'}
])
`
  )

  for (const world of ['iso', 'main']) {
    fs.writeFileSync(
      path.join(root, 'scripts', `${world}.js`),
      `document.documentElement.dataset.${world} = '1'\n`
    )
  }

  return root
}

async function build(root: string, browser: Browser) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    await extensionBuild(root, {
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

  return path.join(root, 'dist', browser)
}

function digests(dir: string): Record<string, string> {
  const found: Record<string, string> = {}

  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const file = path.join(folder, entry.name)

      if (entry.isDirectory()) walk(file)
      else {
        found[path.relative(dir, file).split(path.sep).join('/')] = createHash(
          'sha256'
        )
          .update(fs.readFileSync(file))
          .digest('hex')
      }
    }
  }

  walk(dir)

  return found
}

function backgroundText(dist: string): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf-8')
  )
  const files: string[] = manifest.background.service_worker
    ? [manifest.background.service_worker]
    : manifest.background.scripts

  return files
    .map((file) => fs.readFileSync(path.join(dist, file), 'utf-8'))
    .join('\n')
}

describe.each([
  'chrome',
  'firefox'
] as const)('a %s production build of a background that registers at boot', (browser) => {
  it('is the same bytes on every build, and carries no hold of its own', async () => {
    const first = await build(project(browser), browser)
    const second = await build(project(browser), browser)
    const firstDigests = digests(first)

    expect(Object.keys(firstDigests).length).toBeGreaterThan(3)
    expect(digests(second)).toEqual(firstDigests)

    const background = backgroundText(first)

    // The call the launcher looks for in the built file is the author's.
    expect(background).toContain('registerContentScripts')

    // Nothing of the dev runtime that reports boot registrations is in it.
    for (const file of Object.keys(firstDigests)) {
      if (!/\.(?:js|json|html)$/.test(file)) continue

      const text = fs.readFileSync(path.join(first, file), 'utf-8')

      expect(text, file).not.toContain('boot-registrations')
      expect(text, file).not.toContain('__extjsBridgeProducerInstalled')
    }

    expect(fs.existsSync(path.join(first, 'extension-js-control.json'))).toBe(
      false
    )
  }, 120_000)
})
