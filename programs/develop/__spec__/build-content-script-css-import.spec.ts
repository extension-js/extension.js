import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>, script: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-import-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'css-import',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'css-import',
      version: '1.0.0',
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          ...(script ? {js: ['content.js']} : {}),
          css: ['styles/declared.css']
        }
      ]
    }),
    ...files
  }

  for (const [relative, contents] of Object.entries(all)) {
    const abs = path.join(root, relative)

    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, contents)
  }

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const summary = await buildProject(root, {mode})
  const dir = path.join(root, 'dist', 'chrome', 'content_scripts')
  // A development build stamps the script name, so both are read by kind.
  const read = (extension: string) =>
    fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(extension))
      .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
      .join('\n')

  return {summary, sheet: read('.css'), script: read('.js')}
}

const SHEETS = {
  'styles/declared.css': [
    '@import "base.css";',
    '@import url("print.css") print;',
    '@import "low.css" layer(low);',
    '.declared-own-5b1e { color: red; }',
    ''
  ].join('\n'),
  'styles/base.css':
    '@import "deep/deep.css";\n.declared-base-5b1e { color: blue; }\n',
  'styles/deep/deep.css': '.declared-deep-5b1e { color: green; }\n',
  'styles/print.css': '.declared-print-5b1e { color: black; }\n',
  'styles/low.css': '.declared-low-5b1e { color: gray; }\n'
}

// Chrome drops an @import in a sheet it injects, so a declared sheet has to
// hold the rules of every sheet it imports, each under its own condition.
describe('a sheet the manifest declares for a content script', () => {
  it.each([
    ['production', false],
    ['production', true],
    ['development', false],
    ['development', true]
  ] as const)(
    'holds the rules it imports, in %s with a script: %s',
    async (mode, script) => {
      const root = project(
        {...SHEETS, 'content.js': 'document.title = "css-import"\n'},
        script
      )
      const {summary, sheet, script: emitted} = await build(root, mode)

      expect(summary.errors_count).toBe(0)

      const at = (mark: string) => sheet.indexOf(mark)

      for (const mark of [
        '.declared-deep-5b1e',
        '.declared-base-5b1e',
        '.declared-print-5b1e',
        '.declared-low-5b1e',
        '.declared-own-5b1e'
      ]) {
        expect(at(mark), mark).toBeGreaterThan(-1)
      }

      // In the order the imports ask for, the sheet's own rules last.
      expect(at('.declared-deep-5b1e')).toBeLessThan(at('.declared-base-5b1e'))
      expect(at('.declared-base-5b1e')).toBeLessThan(at('.declared-print-5b1e'))
      expect(at('.declared-low-5b1e')).toBeLessThan(at('.declared-own-5b1e'))
      expect(sheet).not.toContain('@import')
      expect(sheet).toMatch(/@media print\s*\{\s*\.declared-print-5b1e/)
      expect(sheet).toMatch(/@layer low\s*\{\s*\.declared-low-5b1e/)

      // No imported sheet rides in the script as text nothing places.
      expect(emitted).not.toContain('declared-base-5b1e')
      expect(emitted).not.toContain('data:text/css')
    },
    120_000
  )

  it('still inlines a sheet the script itself imports', async () => {
    const root = project(
      {
        ...SHEETS,
        'content.js': "import './styles/script.css'\n",
        'styles/script.css': '.script-own-5b1e { color: red; }\n'
      },
      true
    )
    const {summary, sheet, script} = await build(root, 'production')

    expect(summary.errors_count).toBe(0)
    expect(sheet).not.toContain('script-own-5b1e')
    expect(script).toContain('script-own-5b1e')
  }, 120_000)
})
