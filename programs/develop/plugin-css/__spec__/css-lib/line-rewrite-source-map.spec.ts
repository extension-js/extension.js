import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {lineRewriteSourceMap} from '../../css-lib/line-rewrite-source-map'
import publicCssUrlLoader, {
  PUBLIC_ROOT_SCHEME
} from '../../public-css-url-loader'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, {recursive: true, force: true})

  tempDirs.length = 0
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-map-'))
  tempDirs.push(root)
  fs.writeFileSync(path.join(root, 'manifest.json'), '{}')
  fs.mkdirSync(path.join(root, 'public', 'img'), {recursive: true})
  fs.writeFileSync(path.join(root, 'public', 'img', 'bg.png'), 'png')
  fs.mkdirSync(path.join(root, 'content'), {recursive: true})

  return root
}

function run(root: string, source: string, map?: unknown) {
  const result: {content?: string; map?: unknown} = {}

  publicCssUrlLoader.call(
    {
      resourcePath: path.join(root, 'content', 'styles.css'),
      getOptions: () => ({
        manifestPath: path.join(root, 'manifest.json'),
        projectPath: root
      }),
      callback: (_error: null, content: string, nextMap?: unknown) => {
        result.content = content
        result.map = nextMap
      }
    },
    source,
    map
  )

  return result
}

describe('the map of a line-preserving rewrite', () => {
  it('maps every line onto itself and keeps the author text as the source', () => {
    const original = '.a {\n  background: url(/img/bg.png);\n}\n'
    const rewritten =
      '.a {\n  background: url("https://host.invalid/img/bg.png");\n}\n'

    const map = lineRewriteSourceMap(original, rewritten, '/p/styles.css')

    expect(map.sources).toEqual(['/p/styles.css'])
    expect(map.sourcesContent).toEqual([original])
    expect(map.mappings.split(';')).toHaveLength(4)
    expect(map.mappings).toBe('AAAA;AACA,mDAA6B;AAC7B;AACA')
  })

  it('is an identity map when nothing changed', () => {
    const text = '.a { color: red }\n.b { color: blue }'

    expect(lineRewriteSourceMap(text, text, 'x.css').mappings).toBe('AAAA;AACA')
  })
})

describe('the public url() loader and the map it hands on', () => {
  it('builds a map carrying the author text when no loader ahead made one', () => {
    const root = project()
    const source = ".a {\n  background: url('/img/bg.png');\n}\n"

    const {content, map} = run(root, source)

    expect(content).toContain(`url("${PUBLIC_ROOT_SCHEME}/img/bg.png")`)
    expect(map).toMatchObject({
      version: 3,
      sources: [path.join(root, 'content', 'styles.css')],
      sourcesContent: [source]
    })
  })

  it('passes the map a preprocessor made through untouched', () => {
    const root = project()
    const upstream = {version: 3, sources: ['styles.scss'], mappings: 'AAAA'}

    const {map} = run(root, ".a { background: url('/img/bg.png') }", upstream)

    expect(map).toBe(upstream)
  })

  it('hands on no map of its own when the sheet names nothing public', () => {
    const root = project()

    const {content, map} = run(root, '.a { color: red }')

    expect(content).toBe('.a { color: red }')
    expect(map).toBeUndefined()
  })
})
