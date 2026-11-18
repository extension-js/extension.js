import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {CssPlugin} from '../../plugin-css'
import {JsFrameworksPlugin} from '../../plugin-js-frameworks'
import {StaticAssetsPlugin} from '../index'
import {compileFixture, removeFixtureRoots} from './helpers/compile-harness'

const TYPED_TS =
  'export interface Shape {\n  a: number\n}\nexport const typed: number = 1\n'
const SNIPPET_JS = 'export const snippet = 1\n'
const STYLE_CSS = 'body {\n  color: red;\n}\n'
const NOTES_TXT = 'hello text\n'

afterAll(() => removeFixtureRoots())

// The CSS and JS plugins are here because the contract is theirs too: each
// compiling rule must step aside for ?raw. Their loaders need no build.
function compile(mode: 'development' | 'production') {
  return compileFixture({
    mode,
    plugins: [],
    files: {
      'package.json': JSON.stringify({
        private: true,
        name: `extjs-raw-${mode}`,
        version: '0.0.0'
      }),
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'raw',
        version: '1.0.0',
        background: {service_worker: 'index.js'}
      }),
      'typed.ts': TYPED_TS,
      'snippet.js': SNIPPET_JS,
      'style.css': STYLE_CSS,
      'notes.txt': NOTES_TXT,
      'index.js': [
        "import typedRaw from './typed.ts?raw'",
        "import snippetRaw from './snippet.js?raw'",
        "import styleRaw from './style.css?raw'",
        "import notesRaw from './notes.txt?raw'",
        "import notesUrl from './notes.txt?url'",
        "import {typed} from './typed.ts'",
        "import {snippet} from './snippet.js'",
        'self.out = {typedRaw, snippetRaw, styleRaw, notesRaw, notesUrl, typed, snippet}',
        ''
      ].join('\n')
    },
    config: (root) => {
      const manifestPath = path.join(root, 'manifest.json')

      return {
        plugins: [
          new StaticAssetsPlugin(),
          new CssPlugin({manifestPath, browser: 'chrome'}),
          new JsFrameworksPlugin({manifestPath, browser: 'chrome', mode})
        ]
      }
    }
  })
}

describe('?raw returns the file text for every extension', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`${mode}: ts, js and css ?raw imports are the exact source text`, async () => {
      const build = await compile(mode)
      expect(build.errors).toEqual([])

      const raw = await build.evaluate()

      // swc used to strip the interface and the annotation, the wrapper
      // reprinted the js with a semicolon, and the css rule won the type.
      expect(raw.typedRaw).toBe(TYPED_TS)
      expect(raw.snippetRaw).toBe(SNIPPET_JS)
      expect(raw.styleRaw).toBe(STYLE_CSS)
      expect(raw.notesRaw).toBe(NOTES_TXT)

      // The same files keep compiling through their plain and ?url imports.
      expect(raw.typed).toBe(1)
      expect(raw.snippet).toBe(1)
      expect(raw.notesUrl).toMatch(/^\/assets\/notes\.[0-9a-f]{8}\.txt$/)
    })
  }
})
