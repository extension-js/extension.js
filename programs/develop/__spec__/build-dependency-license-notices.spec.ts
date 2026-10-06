import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const LICENSE_BANNER =
  '/*! fake-dep v1.0.0 | (c) 2026 Fake Authors | @license MIT */'
const PRESERVE_BANNER = '/** @preserve PRESERVE_MARKER must stay */'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-license-'))
  roots.push(root)

  const dependency = path.join(root, 'node_modules', 'fake-dep')
  fs.mkdirSync(dependency, {recursive: true})
  fs.mkdirSync(path.join(root, 'background'))
  fs.mkdirSync(path.join(root, 'content'))

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'license',
      version: '0.0.0',
      dependencies: {'fake-dep': '*'}
    })
  )

  fs.writeFileSync(
    path.join(dependency, 'package.json'),
    JSON.stringify({name: 'fake-dep', version: '1.0.0', main: 'index.js'})
  )

  fs.writeFileSync(
    path.join(dependency, 'index.js'),
    `${LICENSE_BANNER}\n${PRESERVE_BANNER}\n// ORDINARY_COMMENT\nexport function greet(name) { return 'hi ' + name }\n`
  )

  fs.writeFileSync(
    path.join(root, 'background', 'index.js'),
    "import {greet} from 'fake-dep'\nconsole.log('LICENSE_BG', greet('x'))\n"
  )

  fs.writeFileSync(
    path.join(root, 'content', 'index.js'),
    "import {greet} from 'fake-dep'\nconsole.log('LICENSE_CS', greet('y'))\n"
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'license',
      version: '1.0.0',
      background: {service_worker: 'background/index.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content/index.js']}]
    })
  )

  return root
}

async function build(root: string, minify: boolean) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      minify,
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', 'chrome')
  const files = (fs.readdirSync(distDir, {recursive: true}) as unknown[])
    .map((file) => String(file).split(path.sep).join('/'))
    .filter((file) => fs.statSync(path.join(distDir, file)).isFile())
    .sort()

  return {
    files,
    read: (file: string) => fs.readFileSync(path.join(distDir, file), 'utf8'),
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ) as {web_accessible_resources?: unknown}
  }
}

describe("a dependency's license banner in a production build", () => {
  it('moves to a file each minified bundle names, and ordinary comments still go', async () => {
    const dist = await build(project(), true)

    for (const bundle of [
      'background/service_worker.js',
      'content_scripts/content-0.js'
    ]) {
      const notices = `${bundle}.LICENSE.txt`

      expect(dist.files, bundle).toContain(notices)
      expect(dist.read(notices)).toContain(LICENSE_BANNER)
      expect(dist.read(notices)).toContain('PRESERVE_MARKER')
      expect(dist.read(bundle)).toContain(path.posix.basename(notices))
      expect(dist.read(bundle)).not.toContain('ORDINARY_COMMENT')
      expect(dist.read(bundle)).not.toContain('Fake Authors')
    }

    expect(dist.manifest.web_accessible_resources).toBeUndefined()
  }, 180_000)

  it('stays inside the bundle when minification is off', async () => {
    const dist = await build(project(), false)

    expect(dist.files.filter((file) => file.endsWith('.LICENSE.txt'))).toEqual(
      []
    )

    expect(dist.read('background/service_worker.js')).toContain(LICENSE_BANNER)
    expect(dist.read('background/service_worker.js')).toContain(
      'PRESERVE_MARKER'
    )
  }, 180_000)
})
