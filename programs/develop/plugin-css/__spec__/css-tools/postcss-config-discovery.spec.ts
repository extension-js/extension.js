import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  findPostCssConfig,
  maybeUsePostCss,
  postCssConfigSearchPlaces
} from '../../css-tools/postcss'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, {recursive: true, force: true})

  tempDirs.length = 0
})

function createProject(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-postcss-config-'))
  tempDirs.push(dir)

  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, content, 'utf8')
  }

  return dir
}

function loaderSearchPlaces(): string[] {
  const source = fs.readFileSync(
    createRequire(import.meta.url).resolve('postcss-loader/dist/utils.js'),
    'utf8'
  )
  const block = source.match(/searchPlaces = \[([\s\S]*?)\];/)

  if (!block) throw new Error('postcss-loader no longer lists searchPlaces')

  return [...block[1].matchAll(/[`"']([^`"'\n]+)[`"']/g)]
    .map((match) => match[1].replace(/\$\{moduleName\}/g, 'postcss'))
    .filter((place) => place !== 'package.json')
}

describe('postcss config discovery', () => {
  it('searches every place postcss-loader searches', () => {
    const searched = loaderSearchPlaces()

    expect(searched.length).toBeGreaterThan(20)
    expect([...postCssConfigSearchPlaces].sort()).toEqual([...searched].sort())
  })

  // postcss-load-config's README order: every rc spelling, then
  // postcss.config.*. postcss-loader lists postcss.config.* first, and a
  // project with both files once flipped winners when this list followed it.
  it('keeps the rc files ahead of postcss.config.* in the documented order', () => {
    expect(postCssConfigSearchPlaces.slice(0, 16)).toEqual([
      '.postcssrc',
      '.postcssrc.json',
      '.postcssrc.yaml',
      '.postcssrc.yml',
      '.postcssrc.ts',
      '.postcssrc.cts',
      '.postcssrc.mts',
      '.postcssrc.js',
      '.postcssrc.cjs',
      '.postcssrc.mjs',
      'postcss.config.ts',
      'postcss.config.cts',
      'postcss.config.mts',
      'postcss.config.js',
      'postcss.config.cjs',
      'postcss.config.mjs'
    ])

    expect(
      postCssConfigSearchPlaces
        .slice(16)
        .every((place) => place.startsWith('.config/'))
    ).toBe(true)
  })

  it('picks .postcssrc.json over postcss.config.js when a project has both', async () => {
    const dir = createProject({
      'package.json': JSON.stringify({
        name: 'two-configs',
        devDependencies: {postcss: '^8.0.0'}
      }),
      '.postcssrc.json': '{}',
      'postcss.config.js':
        "module.exports = {plugins: [{postcssPlugin: 'marker', Once() {}}]}\n"
    })

    expect(findPostCssConfig(dir)).toBe(path.join(dir, '.postcssrc.json'))

    // The loader is handed that same file, never the directory to search.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const rule = await maybeUsePostCss(dir, {mode: 'production'})
      const options = rule.options?.postcssOptions

      expect(options?.config).toBe(path.join(dir, '.postcssrc.json'))
    } finally {
      warn.mockRestore()
    }
  })

  it('finds each search place in a project that holds only that file', () => {
    for (const place of postCssConfigSearchPlaces) {
      const dir = createProject({[place]: '{}'})

      expect(findPostCssConfig(dir), place).toBe(path.join(dir, place))
    }
  })

  it('leaves a plain .js config for last in a type module project', () => {
    // In the documented order .postcssrc.js precedes postcss.config.cjs, so
    // only the type module sort can make the unambiguous .cjs win.
    const files = {
      '.postcssrc.js': 'module.exports = {}',
      'postcss.config.cjs': 'module.exports = {}'
    }

    const esm = createProject({
      ...files,
      'package.json': JSON.stringify({name: 'esm-fixture', type: 'module'})
    })
    const cjs = createProject({
      ...files,
      'package.json': JSON.stringify({name: 'cjs-fixture'})
    })

    expect(findPostCssConfig(esm)).toBe(path.join(esm, 'postcss.config.cjs'))
    expect(findPostCssConfig(cjs)).toBe(path.join(cjs, '.postcssrc.js'))
  })

  // Node reads the file where it strips types and postcss-loader reads it
  // elsewhere. Either way the sheet has to come out through its plugins.
  it('compiles a sheet through the plugins of a postcss.config.ts', async () => {
    const dir = createProject({
      'package.json': JSON.stringify({
        name: 'postcss-ts-fixture',
        devDependencies: {postcss: '^8.0.0'}
      }),
      'postcss.config.ts': [
        "const marker: string = 'ts-config-ran'",
        'export default {',
        '  plugins: [',
        '    {',
        "      postcssPlugin: 'ts-marker',",
        '      Declaration(decl: {value: string}) {',
        '        decl.value = marker',
        '      }',
        '    }',
        '  ]',
        '}',
        ''
      ].join('\n'),
      'entry.js': 'import "./styles.css"\n',
      'styles.css': '.a { content: authored }\n'
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const rule = await maybeUsePostCss(dir, {mode: 'production'})
      const compiler = rspack({
        context: dir,
        mode: 'production',
        devtool: false,
        entry: {main: './entry.js'},
        output: {path: path.join(dir, 'out')},
        module: {rules: [{test: /\.css$/, type: 'css', use: [rule as never]}]},
        optimization: {minimize: false}
      })

      const errors = await new Promise<string[]>((resolve, reject) =>
        compiler.run((error, stats) =>
          compiler.close(() =>
            error || !stats
              ? reject(error)
              : resolve(stats.compilation.errors.map((e) => e.message))
          )
        )
      )

      expect(errors).toEqual([])
      expect(
        fs.readFileSync(path.join(dir, 'out', 'main.css'), 'utf8')
      ).toContain('content: ts-config-ran')

      expect(warn.mock.calls.flat().join(' ')).not.toContain(
        'postcss.config.ts'
      )
    } finally {
      warn.mockRestore()
    }
  })
})
