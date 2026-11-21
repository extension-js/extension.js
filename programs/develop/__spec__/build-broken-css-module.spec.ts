import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

const BROKEN =
  '.alpha { color: red }\n.beta { content: "unterminated; }\n.gamma { color: green }\n'
const VALID =
  '.alpha { color: red }\n.beta { color: blue }\n.gamma { color: green }\n'

function project(css: string, importKind: 'named' | 'sideEffect') {
  const root = tempFolder('extjs-broken-module-')

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'broken-module',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'broken-module',
      version: '1.0.0',
      options_page: 'options.html'
    }),
    'options.html':
      '<!doctype html><html><head></head><body><h1>options</h1><script src="./options.js"></script></body></html>\n',
    'options.js':
      importKind === 'named'
        ? "import {alpha, beta, gamma} from './options.module.css'\nglobalThis.__classes = [alpha, beta, gamma].join(' ')\n"
        : "import './options.module.css'\nglobalThis.__classes = 'x'\n",
    'options.module.css': css
  }

  for (const [relative, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, relative), contents)
  }

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  let error: unknown

  try {
    await buildProject(root, {mode})
  } catch (caught) {
    error = caught
  } finally {
  }

  const dist = path.join(root, 'dist', 'chrome')
  const files = fs.existsSync(dist)
    ? fs
        .readdirSync(dist, {recursive: true})
        .map((file) => String(file).split(path.sep).join('/'))
    : []
  const read = (extension: string) =>
    files
      .filter((file) => file.endsWith(extension))
      .map((file) => fs.readFileSync(path.join(dist, file), 'utf8'))
      .join('\n')

  return {error, css: read('.css'), js: read('.js')}
}

describe('a css module PostCSS cannot parse ships as authored', () => {
  for (const mode of ['development', 'production'] as const) {
    it(`${mode}: a side-effect import keeps every authored rule`, async () => {
      const {error, css} = await build(project(BROKEN, 'sideEffect'), mode)

      expect(error).toBeUndefined()
      expect(css).toContain('.alpha')
      expect(css).toContain('.gamma')
      expect(css).not.toContain('__extjs_verbatim_')
    })

    it(`${mode}: named imports resolve to the class names the sheet ships`, async () => {
      const {error, css, js} = await build(project(BROKEN, 'named'), mode)

      expect(error).toBeUndefined()
      expect(css).toContain('.alpha')
      expect(js).toMatch(/["']alpha["']/)
      expect(js).toMatch(/["']gamma["']/)
    })
  }

  it('production: a valid css module is still renamed', async () => {
    const {error, css} = await build(project(VALID, 'named'), 'production')

    expect(error).toBeUndefined()
    expect(css).not.toContain('.alpha')
  })
})
