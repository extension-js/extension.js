import * as path from 'node:path'
import * as vm from 'node:vm'
import {
  Compilation,
  type Compiler,
  rspack,
  type Stats,
  sources
} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {writeProject} from '../../__spec__/helpers/real-compiler'
import {decodeSourceMap} from '../../__spec__/helpers/sourcemap-decode'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  isDevServerClientFile,
  stripDevServerStartup
} from '../steps/remove-content-script-dev-server-runtime'
import {StripContentScriptDevServerRuntime} from '../steps/strip-content-script-dev-server-runtime'

const makeTempFolder = trackTempFolders()

const CLIENT = 'node_modules/@rspack/dev-server/client/index.js'
const HOT = 'node_modules/@rspack/core/hot/dev-server.js'
const CONTENT = 'content_scripts/content-0'

// The client's own log lines, which a content script may quote.
const QUOTED =
  "'@rspack/dev-server/client/index.js?x [HMR] Waiting for update signal from WDS... webpack-dev-server WebSocketClient'"

// A project with a stand-in for the installed dev client. Each file says
// that it ran, so a bundle shows which of its modules it starts.
function project(files: Record<string, string> = {}) {
  return writeProject(makeTempFolder('extjs-strip-'), {
    [CLIENT]: "console.log('CLIENT_STARTED')\n",
    [HOT]: "console.log('HOT_STARTED')\n",
    'content.js': "console.log('CONTENT_STARTED')\n",
    ...files
  })
}

interface Built {
  code: (name: string) => string
  warnings: Array<{name: string; file?: string; message: string}>
  stats: Stats
}

// What a dev session builds with: numeric module ids, no concatenation and
// the hot runtime, which keeps every entry module in the module table.
async function build(
  root: string,
  entry: Record<string, string[]>,
  plugins: Array<{apply(compiler: Compiler): void}>,
  extra: {devtool?: 'source-map'; output?: string; hot?: boolean} = {}
): Promise<Built> {
  const compiler = rspack({
    mode: 'development',
    context: root,
    devtool: extra.devtool ?? false,
    entry: Object.fromEntries(
      Object.entries(entry).map(([name, files]) => [
        name,
        {import: files.map((file) => path.join(root, file))}
      ])
    ),
    output: {path: path.join(root, extra.output ?? 'dist'), publicPath: '/'},
    optimization: {moduleIds: 'deterministic', concatenateModules: false},
    plugins: [
      ...(extra.hot === false ? [] : [new rspack.HotModuleReplacementPlugin()]),
      ...plugins
    ]
  })
  const stats = await new Promise<Stats>((resolve, reject) =>
    compiler.run((error, result) =>
      error || !result ? reject(error) : resolve(result)
    )
  )

  await new Promise((resolve) => compiler.close(resolve))

  expect(stats.compilation.errors.map((error) => error.message)).toEqual([])

  return {
    stats,
    code: (name) => String(stats.compilation.getAsset(name)?.source.source()),
    warnings: stats.compilation.warnings.map(
      (warning: Error & {file?: string}) => ({
        name: warning.name,
        ...(warning.file ? {file: warning.file} : {}),
        message: warning.message
      })
    )
  }
}

// Runs a bundle and returns what its modules logged, in order.
function started(code: string): string[] {
  const logged: string[] = []
  const scope = {console: {log: (line: string) => logged.push(line)}}

  vm.runInNewContext(code, {...scope, self: scope, globalThis: scope})

  return logged
}

describe('which files are the dev client', () => {
  it('names a module by the package folder it was read from', () => {
    const rows: Array<[string, boolean]> = [
      ['/p/node_modules/@rspack/dev-server/client/index.js', true],
      ['/p/node_modules/@rspack/dev-server/client/index.js?port=8080', true],
      [
        '/p/node_modules/@rspack/dev-server/client/clients/WebSocketClient.js',
        true
      ],
      [
        '/p/node_modules/.pnpm/@rspack+core@2/node_modules/@rspack/core/hot/dev-server.js',
        true
      ],
      ['C:\\p\\node_modules\\@rspack\\core\\hot\\only-dev-server.js', true],
      ['/p/node_modules/webpack/hot/dev-server.js', true],
      ['/p/node_modules/webpack-dev-server/client/index.js', true],
      ['/p/node_modules/@rspack/core/dist/index.js', false],
      ['/p/node_modules/@rspack/dev-server/dist/index.js', false],
      ['/p/src/@rspack/dev-server/client/index.js', false],
      ['/p/src/content.js', false],
      ['', false]
    ]

    for (const [file, expected] of rows) {
      expect(isDevServerClientFile(file), file).toBe(expected)
    }
  })
})

describe('the startup lines a strip takes out of bundle text', () => {
  const bundle = (startup: string[]) =>
    [
      '123(module) {',
      `  console.log(${QUOTED})`,
      '}',
      '456(module) {',
      "  console.log('keep me')",
      '}',
      '// startup',
      ...startup,
      'var __webpack_exports__ = __webpack_require__(999);'
    ].join('\n')

  it('removes the line of each id it is given and no other', () => {
    const source = bundle([
      '__webpack_require__(123);',
      '__webpack_require__(456);',
      '__webpack_require__(12);'
    ])
    const stripped = stripDevServerStartup(source, [123])

    expect(stripped.source).toBe(
      bundle(['__webpack_require__(456);', '__webpack_require__(12);'])
    )

    expect(stripped.removed).toHaveLength(1)
    expect(source.slice(...stripped.removed[0])).toBe(
      '__webpack_require__(123);\n'
    )
  })

  it('leaves a module alone for what its text says', () => {
    const source = bundle(['__webpack_require__(123);'])

    expect(stripDevServerStartup(source, [])).toEqual({
      source,
      removed: [],
      kept: []
    })
  })

  it('reads a named id as the string the bundle writes', () => {
    const named = './node_modules/@rspack/core/hot/dev-server.js'
    const source = bundle([
      `__webpack_require__(${JSON.stringify(named)});`,
      '__webpack_require__(456);'
    ])

    expect(stripDevServerStartup(source, [named]).source).toBe(
      bundle(['__webpack_require__(456);'])
    )
  })

  it('removes nothing above the startup section', () => {
    const source = [
      '456(module, exports, __webpack_require__) {',
      '__webpack_require__(123);',
      '}',
      '// startup',
      '__webpack_require__(456);'
    ].join('\n')

    expect(stripDevServerStartup(source, [123]).source).toBe(source)
  })

  it('names an id as kept when its start is not a line of its own', () => {
    const source = bundle([
      'var client = __webpack_require__(123);',
      '__webpack_require__(456);'
    ])

    expect(stripDevServerStartup(source, [123, 456])).toEqual({
      source: bundle(['var client = __webpack_require__(123);']),
      removed: [[expect.any(Number), expect.any(Number)]],
      kept: [123]
    })
  })

  it('names every id as kept in a bundle with no startup section', () => {
    const source = 'console.log("written in line")\n'

    expect(stripDevServerStartup(source, [123, 'named'])).toEqual({
      source,
      removed: [],
      kept: [123, 'named']
    })
  })
})

describe('the dev client in a compiled content script', () => {
  it('starts in a bundle nothing stripped, which is what the step is for', async () => {
    const root = project()
    const plain = await build(
      root,
      {[CONTENT]: [CLIENT, HOT, 'content.js']},
      []
    )

    expect(started(plain.code(`${CONTENT}.js`))).toEqual([
      'CLIENT_STARTED',
      'HOT_STARTED',
      'CONTENT_STARTED'
    ])
  })

  it('is no longer started, and the content script still is', async () => {
    const root = project()
    const built = await build(root, {[CONTENT]: [CLIENT, HOT, 'content.js']}, [
      new StripContentScriptDevServerRuntime()
    ])

    expect(started(built.code(`${CONTENT}.js`))).toEqual(['CONTENT_STARTED'])
    expect(built.warnings).toEqual([])
  })

  it('leaves a content script that quotes the client running', async () => {
    const root = project({
      'quoting.js': `console.log('QUOTING_STARTED', ${QUOTED}.length)\n`
    })
    const built = await build(
      root,
      {[CONTENT]: [CLIENT, 'quoting.js', 'content.js']},
      [new StripContentScriptDevServerRuntime()]
    )

    expect(started(built.code(`${CONTENT}.js`))).toEqual([
      'QUOTING_STARTED',
      'CONTENT_STARTED'
    ])

    expect(built.warnings).toEqual([])
  })

  it('leaves a bundle with no client as the bundler wrote it', async () => {
    const root = project({
      'quoting.js': `console.log('QUOTING_STARTED', ${QUOTED}.length)\n`
    })
    const entry = {[CONTENT]: ['quoting.js', 'content.js']}
    const plain = await build(root, entry, [], {output: 'plain'})
    const built = await build(root, entry, [
      new StripContentScriptDevServerRuntime()
    ])

    expect(built.code(`${CONTENT}.js`)).toBe(plain.code(`${CONTENT}.js`))
    expect(built.warnings).toEqual([])
  })

  it('is left alone in a bundle that is not a content script', async () => {
    const root = project()
    const built = await build(
      root,
      {
        [CONTENT]: [CLIENT, 'content.js'],
        'background/script': [CLIENT, 'content.js'],
        'content_scripts/helper': [CLIENT, 'content.js']
      },
      [new StripContentScriptDevServerRuntime()]
    )

    expect(started(built.code(`${CONTENT}.js`))).toEqual(['CONTENT_STARTED'])

    for (const name of ['background/script.js', 'content_scripts/helper.js']) {
      expect(started(built.code(name)), name).toEqual([
        'CLIENT_STARTED',
        'CONTENT_STARTED'
      ])
    }
  })
})

describe('the dev-server runtime warning', () => {
  // A stand-in for a bundler that writes the start another way.
  const startWrittenAnotherWay = {
    apply(compiler: Compiler) {
      compiler.hooks.thisCompilation.tap('rewrite-start', (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'rewrite-start',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE
          },
          () => {
            const name = `${CONTENT}.js`
            const code = String(compilation.getAsset(name)?.source.source())
            const [first] = /^__webpack_require__\(\d+\);$/m.exec(code) || []

            expect(first).toBeDefined()

            compilation.updateAsset(
              name,
              new sources.RawSource(
                code.replace(first as string, `void ${first}`)
              )
            )
          }
        )
      })
    }
  }

  it('names a content script whose client start could not be taken out', async () => {
    const root = project()
    const built = await build(root, {[CONTENT]: [CLIENT, 'content.js']}, [
      startWrittenAnotherWay,
      new StripContentScriptDevServerRuntime()
    ])

    expect(started(built.code(`${CONTENT}.js`))).toEqual([
      'CLIENT_STARTED',
      'CONTENT_STARTED'
    ])

    expect(built.warnings).toEqual([
      {
        name: 'ContentScriptDevServerRuntimeWarning',
        file: `${CONTENT}.js`,
        message: expect.stringContaining(
          `Could not strip the dev-server runtime from ${CONTENT}.js.`
        )
      }
    ])
  })

  // With no hot runtime the bundler writes each entry module in line, with
  // no start to take out, so the client runs and the build has to say so.
  it('names a content script whose client the bundler wrote in line', async () => {
    const root = project()
    const built = await build(
      root,
      {[CONTENT]: [CLIENT, 'content.js']},
      [new StripContentScriptDevServerRuntime()],
      {hot: false}
    )

    expect(started(built.code(`${CONTENT}.js`))).toEqual([
      'CLIENT_STARTED',
      'CONTENT_STARTED'
    ])

    expect(built.warnings).toEqual([
      expect.objectContaining({
        name: 'ContentScriptDevServerRuntimeWarning',
        file: `${CONTENT}.js`
      })
    ])
  })

  it('is not raised for a content script that only names the client', async () => {
    const root = project({
      'content.js': "console.log('see @rspack/dev-server/client for details')\n"
    })
    const built = await build(root, {[CONTENT]: ['content.js']}, [
      new StripContentScriptDevServerRuntime()
    ])

    expect(built.warnings).toEqual([])
  })
})

// The devtool wrote the map before this step, so the line it removes must
// leave the map too, or each line below it points one line off.
describe('the source map of a stripped content script', () => {
  it('drops the mapping of the start line it removes', async () => {
    const root = project()
    const entry = {[CONTENT]: [CLIENT, 'content.js']}
    const read = (built: Built) => ({
      code: built.code(`${CONTENT}.js`),
      map: decodeSourceMap(built.code(`${CONTENT}.js.map`))
    })
    const plain = read(
      await build(root, entry, [], {devtool: 'source-map', output: 'plain'})
    )
    const stripped = read(
      await build(root, entry, [new StripContentScriptDevServerRuntime()], {
        devtool: 'source-map'
      })
    )
    const lines = stripped.code.split('\n')
    const removed = plain.code
      .split('\n')
      .findIndex((line, index) => line !== lines[index])

    expect(removed).toBeGreaterThan(0)
    expect(stripped.code.split('\n')).toHaveLength(
      plain.code.split('\n').length - 1
    )

    expect(stripped.map.lines).toEqual(
      plain.map.lines.filter((_, index) => index !== removed)
    )
  })
})
