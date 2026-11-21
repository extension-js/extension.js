import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {CompilationPlugin} from '../index'
import {
  createCompiler,
  makeTempRoot,
  messagesOf,
  removeTempRoots,
  runCompiler,
  runScript,
  writeFiles
} from './helpers/real-compile'

type Command = 'dev' | 'start' | 'preview' | 'build'

const DYNAMIC_REQUIRE = 'module.exports = (name) => require(name)\n'

// Rspack after 2.3.3 renames this warning (web-infra-dev/rspack#16771).
const OLD_EXPRESSION_WARNING =
  'Critical dependency: the request of a dependency is an expression'
const NEW_EXPRESSION_WARNING =
  'Dynamic module path: Rspack cannot determine which modules to bundle because the path is unknown at build time.'
const EXPRESSION_WARNING =
  /Critical dependency: the request of a dependency is an expression|Dynamic module path: Rspack cannot determine which modules to bundle because the path is unknown at build time\./
// The printed line goes through scrubBrand, which names Extension.js.
const PRINTED_EXPRESSION_WARNING =
  /Critical dependency: the request of a dependency is an expression|Dynamic module path: Extension\.js cannot determine which modules to bundle because the path is unknown at build time\./

function scaffold(entry = 'console.log("ran")\n') {
  const root = makeTempRoot('compilation')
  writeFiles(root, {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Real Name',
      version: '1.0.0'
    }),
    'background.js': entry
  })

  return root
}

function compilerFor(
  root: string,
  options: Partial<ConstructorParameters<typeof CompilationPlugin>[0]> & {
    mode?: 'development' | 'production'
    nodeEnv?: string | false
    later?: (compiler: Compiler) => void
  } = {}
) {
  const {mode, nodeEnv, later, ...pluginOptions} = options

  return createCompiler({
    context: root,
    outputPath: path.join(root, 'dist', 'chrome'),
    mode: mode || 'development',
    nodeEnv,
    entry: {background: './background.js'},
    plugins: [
      new CompilationPlugin({
        manifestPath: path.join(root, 'manifest.json'),
        browser: 'chrome',
        browserLaunchEnabled: false,
        ...pluginOptions
      }),
      ...(later ? [{apply: later}] : [])
    ]
  })
}

const doneTaps = (compiler: Compiler) =>
  compiler.hooks.done.taps.map((tap) => tap.name)

let log: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.restoreAllMocks()
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
  removeTempRoots()
})

describe('CompilationPlugin on a real compiler', () => {
  // The watch-only plugins register on every command and act only once
  // compiler.watch() sets watchMode, so a build or start passes them by.
  const taps: Record<Command, string[]> = {
    dev: [
      'plugin-compilation:warm-ancestor-watchers',
      'CaseSensitivePathsPlugin',
      'extension.js:done',
      'develop:brand'
    ],
    preview: [
      'plugin-compilation:warm-ancestor-watchers',
      'CaseSensitivePathsPlugin',
      'plugin-zip',
      'extension.js:done',
      'develop:brand'
    ],
    build: [
      'plugin-compilation:warm-ancestor-watchers',
      'CaseSensitivePathsPlugin',
      'plugin-zip',
      'develop:brand'
    ],
    start: [
      'plugin-compilation:warm-ancestor-watchers',
      'CaseSensitivePathsPlugin',
      'plugin-zip',
      'develop:brand'
    ]
  }

  for (const [command, expected] of Object.entries(taps)) {
    it(`registers the done taps for ${command} with zip requested`, () => {
      const compiler = compilerFor(scaffold(), {
        command: command as Command,
        zip: true
      })

      expect(doneTaps(compiler)).toEqual(
        process.platform === 'darwin' ? expected : expected.slice(1)
      )
    })
  }

  it('registers no zip on build when neither archive is asked for', () => {
    const compiler = compilerFor(scaffold(), {command: 'build'})

    expect(doneTaps(compiler)).not.toContain('plugin-zip')
    expect(doneTaps(compiler)).toContain('develop:brand')
  })

  it('prints one summary line naming the manifest', async () => {
    await runCompiler(compilerFor(scaffold(), {command: 'build'}))

    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toMatch(
      /^⏵⏵⏵ \[\d{2}:\d{2}:\d{2}\] Real Name compiled in \d+ ms\.$/
    )
  })

  it('prints a line per compile with no browser, one at startup with one', async () => {
    for (const [browserLaunchEnabled, lines] of [
      [false, 2],
      [true, 1]
    ] as const) {
      log.mockClear()
      const compiler = compilerFor(scaffold(), {
        command: 'build',
        browserLaunchEnabled
      })
      await new Promise<void>((resolve, reject) =>
        compiler.run((e) => (e ? reject(e) : resolve()))
      )

      await runCompiler(compiler)

      expect(log).toHaveBeenCalledTimes(lines)
    }
  })

  it('hides a critical dependency warning from node_modules only', async () => {
    const root = scaffold(
      "require('dyn')('a')\nrequire('./own.js')('b')\nconsole.log('ran')\n"
    )
    writeFiles(root, {
      'node_modules/dyn/package.json': '{"name":"dyn","main":"index.js"}',
      'node_modules/dyn/index.js': DYNAMIC_REQUIRE,
      'own.js': DYNAMIC_REQUIRE
    })

    const stats = await runCompiler(compilerFor(root, {command: 'build'}))
    const warnings = stats.toJson({all: false, warnings: true}).warnings || []

    expect(
      warnings.map((warning) => [warning.moduleName, warning.message])
    ).toEqual([['./own.js', expect.stringMatching(EXPRESSION_WARNING)]])
  })

  const ignoreOf = (compiler: Compiler) =>
    (compiler.options.ignoreWarnings || []).at(-1) as (
      warning: unknown
    ) => boolean
  const warningFrom = (message: string, resource: string) => ({
    message: `  ⚠ ${message}\n`,
    module: {resource}
  })

  for (const message of [OLD_EXPRESSION_WARNING, NEW_EXPRESSION_WARNING]) {
    const title = message.split(':')[0]

    it(`hides the "${title}" warning from node_modules`, () => {
      const ignore = ignoreOf(compilerFor(scaffold()))

      expect(ignore(warningFrom(message, '/p/node_modules/dyn/index.js'))).toBe(
        true
      )
    })

    it(`keeps the "${title}" warning from a project module`, () => {
      const ignore = ignoreOf(compilerFor(scaffold()))

      expect(ignore(warningFrom(message, '/p/own.js'))).toBe(false)
    })
  }

  it('prints dev warnings before a later done tap such as a browser launch', async () => {
    const root = scaffold("require('./own.js')('b')\n")
    writeFiles(root, {'own.js': DYNAMIC_REQUIRE})
    const launch = vi.fn()
    await runCompiler(
      compilerFor(root, {
        command: 'dev',
        later: (compiler) => compiler.hooks.done.tap('launch', launch)
      })
    )

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(PRINTED_EXPRESSION_WARNING)

    expect(launch).toHaveBeenCalledTimes(1)
    expect(warn.mock.invocationCallOrder[0]).toBeLessThan(
      launch.mock.invocationCallOrder[0]
    )
  })

  for (const [command, printed] of [
    ['dev', 1],
    ['preview', 1],
    ['build', 0],
    ['start', 0]
  ] as const) {
    it(`prints compile errors itself ${printed} time(s) on ${command}`, async () => {
      const stats = await runCompiler(
        compilerFor(scaffold("import './missing-module'\n"), {command})
      )

      expect(messagesOf(stats, 'errors')).toEqual([
        expect.stringContaining("Can't resolve './missing-module'")
      ])

      expect(error).toHaveBeenCalledTimes(printed)

      if (printed) {
        expect(String(error.mock.calls[0][0])).toContain(
          "Can't resolve './missing-module'"
        )
      }
    })
  }

  it('hands the browser and mode to the bundle through EnvPlugin', async () => {
    const root = scaffold(
      'console.log(process.env.EXTENSION_PUBLIC_BROWSER, import.meta.env.EXTENSION_PUBLIC_MODE)\n'
    )
    await runCompiler(
      compilerFor(root, {command: 'build', browser: 'edge', mode: 'production'})
    )

    expect(runScript(path.join(root, 'dist/chrome/background.js'))).toEqual([
      'edge production'
    ])
  })

  for (const mode of ['development', 'production'] as const) {
    it(`gives the bundle process.env.NODE_ENV as ${mode}`, async () => {
      const root = scaffold('console.log(process.env.NODE_ENV)\n')
      await runCompiler(compilerFor(root, {command: 'build', mode}))

      expect(runScript(path.join(root, 'dist/chrome/background.js'))).toEqual([
        mode
      ])
    })
  }

  // rspack's optimization.nodeEnv owns the define, so a project can turn it off.
  it('leaves NODE_ENV undefined when optimization.nodeEnv is false', async () => {
    const root = scaffold('console.log(process.env.NODE_ENV)\n')
    await runCompiler(
      compilerFor(root, {command: 'build', mode: 'production', nodeEnv: false})
    )

    expect(runScript(path.join(root, 'dist/chrome/background.js'))).toEqual([
      'undefined'
    ])
  })
})
