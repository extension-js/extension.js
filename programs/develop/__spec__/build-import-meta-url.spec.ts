import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A bundled library that reads import.meta.url must not ship the build
// machine's folders, and new URL(x, import.meta.url) must still emit x.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-meta-url-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'meta-url', version: '0.0.0'})
  )

  const dep = path.join(root, 'node_modules', 'meta-url-dep')
  fs.mkdirSync(dep, {recursive: true})
  fs.writeFileSync(
    path.join(dep, 'package.json'),
    JSON.stringify({name: 'meta-url-dep', type: 'module', main: 'index.mjs'})
  )

  fs.writeFileSync(
    path.join(dep, 'index.mjs'),
    'export function base(override) {\n  return override || import.meta.url\n}\n'
  )

  // Above the asset inline limit, so it ships as a file instead of a data URI.
  fs.writeFileSync(
    path.join(root, 'asset.txt'),
    `META_URL_ASSET\n${'x'.repeat(16_000)}\n`
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'import {base} from "meta-url-dep"',
      'const assetUrl = new URL("./asset.txt", import.meta.url)',
      'console.log("META_URL_BASE", base(self.__override), import.meta.url, assetUrl.href)',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'meta-url',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', 'chrome')
  const files = fs
    .readdirSync(distDir, {recursive: true})
    .map((file) => String(file).split(path.sep).join('/'))
    .filter((file) => fs.statSync(path.join(distDir, file)).isFile())
  const read = (file: string) =>
    fs.readFileSync(path.join(distDir, file), 'utf8')

  return {distDir, files, read}
}

describe('import.meta.url in a production build', () => {
  it('keeps the project path out of dist and still emits new URL assets', async () => {
    const root = project()
    const {files, read} = await build(root)

    const bundle = files.find((file) => read(file).includes('META_URL_BASE'))
    expect(bundle, files.join(',')).toBeDefined()

    // Compare in slash form: the leak is a file:// URL, which always uses "/".
    const needles = new Set(
      [root, fs.realpathSync(root)].map((dir) =>
        dir.split(path.sep).join('/').replace(/^\/+/, '')
      )
    )

    for (const file of files) {
      const content = read(file)
      expect(content, file).not.toContain('file://')

      for (const needle of needles) {
        expect(content.split('\\').join('/'), file).not.toContain(needle)
      }
    }

    const asset = files.find(
      (file) => file !== bundle && read(file).includes('META_URL_ASSET')
    )
    expect(asset, files.join(',')).toBeDefined()
    expect(read(String(bundle))).toContain(path.posix.basename(String(asset)))
  }, 180_000)
})
