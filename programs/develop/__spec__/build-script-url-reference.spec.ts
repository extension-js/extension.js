import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {isStylesheetIssuer} from '../lib/unresolved-css-url-refs'
import {buildProject} from './helpers/build-project'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-script-url-'))
  )
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'script-url',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'script-url',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['https://sheet.example/*'], js: ['content/index.js']}
      ]
    }),
    'background.js':
      'console.log(new URL("./gone-beside-script.png", import.meta.url).href)\n',
    'content/index.js': "import './own.css'\n",
    'content/own.css': ".own { background: url('./gone-beside-sheet.png') }\n"
  }

  for (const [relative, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive: true})
    fs.writeFileSync(path.join(root, relative), contents)
  }

  return root
}

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

describe('build: a script names a file with new URL() that is not there', () => {
  it('words it as a script reference and keeps the stylesheet words for a sheet', async () => {
    const summary = await buildProject(project())
    const warnings = ((summary.warnings || []) as string[]).map(plain)
    const about = (file: string) =>
      warnings.filter((text) => text.includes(file))

    expect(summary.errors_count).toBe(0)
    expect(about('gone-beside-script.png')).toHaveLength(1)
    expect(about('gone-beside-script.png')[0]).toContain(
      'A new URL("./gone-beside-script.png", import.meta.url) reference names no file beside the script and no installed package.'
    )

    expect(about('gone-beside-script.png')[0]).toContain('PATH background.js')
    expect(about('gone-beside-script.png')[0]).toMatch(
      /^W_SCRIPT_DEP_MISSING: /
    )

    expect(about('gone-beside-sheet.png')[0]).toMatch(/^W_CSS_DEAD_REF: /)
    expect(about('gone-beside-script.png')[0]).not.toMatch(/stylesheet|url\(/)

    expect(about('gone-beside-sheet.png')).toHaveLength(1)
    expect(about('gone-beside-sheet.png')[0]).toMatch(
      /url\(.*gone-beside-sheet\.png.*\) reference/
    )
  }, 60_000)
})

describe('the file that asks decides the words', () => {
  it.each([
    ['/p/content/own.css', true],
    ['/p/content/own.SCSS', true],
    ['/p/content/own.module.less?inline', true],
    ['/p/App.vue?vue&type=style&index=0&lang.css', true],
    ['/p/Card.svelte?svelte&type=style&lang.css', true],
    ['', true],
    ['/p/background.js', false],
    ['/p/src/main.tsx', false],
    ['/p/App.vue?vue&type=script&setup=true&lang.ts', false],
    ['/p/styles.css.js', false],
    ['/p/page.js?type=stylesheet', false]
  ])('%j from a stylesheet: %j', (issuer, expected) => {
    expect(isStylesheetIssuer(issuer)).toBe(expected)
  })
})
