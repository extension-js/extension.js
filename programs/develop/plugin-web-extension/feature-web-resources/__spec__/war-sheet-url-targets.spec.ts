import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from '../../../__spec__/helpers/build-project'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'

const makeTempFolder = trackTempFolders()

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

// A stylesheet listed in web_accessible_resources is copied as written. The
// files its url() names ship only when something else lists them too.
function project(sheet: string, resources: string[]) {
  const root = fs.realpathSync(makeTempFolder('extjs-war-sheet-'))
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'war-sheet',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'war-sheet',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      web_accessible_resources: [
        {resources, matches: ['https://example.com/*']}
      ]
    }),
    'background.js': 'console.log("background")\n',
    'war/sheet.css': sheet,
    'war/listed.png': 'PNG',
    'war/beside.png': 'PNG',
    'war/deep/also.png': 'PNG'
  }

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

async function build(sheet: string, resources: string[]) {
  const root = project(sheet, resources)
  const summary = await buildProject(root)
  const warnings = ((summary.warnings || []) as string[]).map(plain)

  return {
    root,
    errors: summary.errors_count,
    warnings,
    shipped: (name: string) =>
      fs.existsSync(path.join(root, 'dist', 'chrome', name))
  }
}

describe('a stylesheet listed in web_accessible_resources', () => {
  it('warns once for each url() target the build does not ship', async () => {
    const result = await build(
      [
        '.a { background: url(./beside.png) }',
        '.b { background: url("/war/deep/also.png?v=2#frag") }',
        '.c { background: url(./beside.png) }',
        ".d { background: url('./listed.png') }",
        '.e { background: url(data:image/png;base64,AAAA) }',
        '.f { background: url(https://cdn.example/x.png) }',
        '.g { background: url(//cdn.example/y.png) }',
        '.h { filter: url(#blur) }',
        '/* url(./in-a-comment.png) */',
        ''
      ].join('\n'),
      ['war/sheet.css', 'war/listed.png']
    )

    expect(result.errors).toBe(0)
    expect(result.shipped('war/sheet.css')).toBe(true)
    expect(result.shipped('war/listed.png')).toBe(true)
    expect(result.shipped('war/beside.png')).toBe(false)
    expect(result.warnings).toEqual([
      'W_WAR_INVALID: war/sheet.css is listed in web_accessible_resources and names 2 files with url() that the build does not ship.\n' +
        'NOT SHIPPED war/beside.png\n' +
        'NOT SHIPPED war/deep/also.png\n' +
        'A listed stylesheet is copied as written, so the browser answers each of these with a 404.\n' +
        'List them in web_accessible_resources beside the stylesheet, or remove the references.'
    ])
  }, 60_000)

  it('stays quiet when every target ships', async () => {
    const result = await build(
      '.a { background: url(./beside.png) }\n.b { background: url(/war/deep/also.png) }\n',
      ['war/sheet.css', 'war/beside.png', 'war/deep/*']
    )

    expect(result.errors).toBe(0)
    expect(result.shipped('war/beside.png')).toBe(true)
    expect(result.shipped('war/deep/also.png')).toBe(true)
    expect(result.warnings).toEqual([])
  }, 60_000)
})
