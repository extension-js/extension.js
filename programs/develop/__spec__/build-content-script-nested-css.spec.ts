import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(declaredCss: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-nested-css-'))
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'nested-css',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'nested-css',
      version: '1.0.0',
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          js: ['content.js'],
          ...(declaredCss ? {css: ['declared.css']} : {})
        }
      ]
    }),
    'content.js':
      "import './entry.css'\nimport {mount} from './App.js'\nmount()\n",
    'App.js':
      "import './deep.css'\nexport function mount() {\n  globalThis.__mounted = true\n}\n",
    'entry.css': '.entry-marker { color: red; }\n',
    'deep.css': '.deep-marker { color: blue; }\n',
    'declared.css': '.declared-marker { color: green; }\n'
  }

  for (const [relative, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, relative), contents)
  }

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    await extensionBuild(root, {
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

  const dist = path.join(root, 'dist', 'chrome')
  const files = fs
    .readdirSync(dist, {recursive: true})
    .map((file) => String(file).split(path.sep).join('/'))
  const read = (extension: string) =>
    files
      .filter((file) => file.endsWith(extension))
      .map((file) => fs.readFileSync(path.join(dist, file), 'utf8'))
      .join('\n')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )

  return {css: read('.css'), js: read('.js'), manifest}
}

describe('content-script css is inlined however deep the import is', () => {
  for (const mode of ['development', 'production'] as const) {
    it(`${mode}: a stylesheet a component imports stays out of the page`, async () => {
      const {css, js, manifest} = await build(project(false), mode)

      expect(css).not.toContain('deep-marker')
      expect(css).not.toContain('entry-marker')
      expect(js).toContain('deep-marker')
      expect(js).toContain('entry-marker')
      expect(manifest.content_scripts[0].css || []).toEqual([])
      expect(manifest.web_accessible_resources).toBeUndefined()
    })
  }

  it('a stylesheet the manifest declares is still emitted as a file', async () => {
    const {css, js, manifest} = await build(project(true), 'production')

    expect(css).toContain('declared-marker')
    expect(css).not.toContain('deep-marker')
    expect(js).toContain('deep-marker')
    expect(manifest.content_scripts[0].css).toHaveLength(1)
  })
})
