import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, relPath: string, contents: string | Buffer) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-package-sheet-'))
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'package-sheet', version: '0.0.0'})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'package-sheet',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'},
      content_scripts: [
        {matches: ['https://sheet.example/*'], js: ['content/index.js']}
      ]
    })
  )

  write(
    root,
    'node_modules/packaged-sheet/package.json',
    JSON.stringify({name: 'packaged-sheet', version: '1.0.0'})
  )

  write(
    root,
    'node_modules/packaged-sheet/index.css',
    '.packaged-sheet-rule { color: rgb(1, 2, 3) }\n'
  )

  write(
    root,
    'content/index.js',
    "import 'packaged-sheet/index.css'\nimport './own.css'\n"
  )

  write(
    root,
    'content/own.css',
    ".own { background: url('./gone-beside-own.png') }\n"
  )

  write(
    root,
    'popup/index.html',
    '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"></head><body>popup</body></html>\n'
  )

  write(root, 'popup/popup.css', 'body { background: url(hosted-only.png) }\n')
  write(root, 'public/hosted-only.png', Buffer.alloc(3000, 'h'))

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function contentBundle(root: string): string {
  const distDir = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  ) as {content_scripts: Array<{js: string[]}>}

  return manifest.content_scripts[0].js
    .map((name) => fs.readFileSync(path.join(distDir, name), 'utf8'))
    .join('\n')
}

describe('build: a content script imports a stylesheet from a package', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: bundles the sheet without calling it missing, and still reports a url() that is`, async () => {
      const root = project()
      const summary = await build(root, mode)
      const warnings = ((summary.warnings || []) as string[]).map(
        (line) => line.split('\n')[0]
      )
      const naming = (token: string) =>
        warnings.filter((line) => line.includes(token))

      expect(summary.errors_count).toBe(0)
      expect(naming('packaged-sheet')).toEqual([])
      expect(naming('"hosted-only.png" was not found on disk')).toHaveLength(1)
      expect(naming('./gone-beside-own.png')).toHaveLength(1)
      expect(warnings).toHaveLength(2)

      const bundle = contentBundle(root)

      expect(bundle).toContain('.packaged-sheet-rule')
      expect(bundle).not.toContain('"packaged-sheet/index.css"')
    }, 120_000)
  }
})
