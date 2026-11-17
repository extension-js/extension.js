import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, EntryPlugin} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {EnvPlugin} from '../env'
import {
  compile,
  makeTempRoot,
  messagesOf,
  removeTempRoots,
  runScript,
  writeFiles
} from './helpers/real-compile'

type Mode = 'development' | 'production'

const MODES: Mode[] = ['development', 'production']

// One entry per way a bundle can touch process, each logging what it read.
const ENTRIES: Record<string, string> = {
  none: "console.log('none')\n",
  literal: 'console.log("x")\n',
  dotted: 'console.log(process.env.EXTENSION_PUBLIC_X)\n',
  dynamic: "const key = 'EXTENSION_PUBLIC_X'\nconsole.log(process.env[key])\n",
  destructure:
    'const {EXTENSION_PUBLIC_X} = process.env\nconsole.log(EXTENSION_PUBLIC_X)\n',
  whole: 'console.log(JSON.stringify(process.env))\n',
  parity:
    'console.log(JSON.stringify(process.env) === JSON.stringify(import.meta.env))\n',
  secret:
    "const key = 'EXTENSION_SECRET'\nconsole.log(process.env.EXTENSION_SECRET, process.env[key], process.env.PLAIN)\n",
  mutate: "process.env.FOO = 'x'\nconsole.log(process.env.FOO)\n",
  typeof: 'console.log(typeof process)\n',
  nextTick:
    "process.nextTick((a, b) => console.log('tick', a, b), 1, 2)\nconsole.log('sync')\n",
  platform: 'console.log(process.platform)\n',
  cwd: 'console.log(process.cwd())\n',
  members:
    'console.log(JSON.stringify([process.argv, process.version, process.versions, process.arch, process.browser, process.title, process.pid, process.umask(), process.chdir("/x"), process.listeners("exit")]))\n' +
    'console.log(["on", "once", "off", "addListener", "removeListener", "removeAllListeners", "prependListener", "prependOnceListener", "emit"].map((name) => String(process[name]("exit", () => {}))).join())\n'
}

const ENV_FILE = 'EXTENSION_PUBLIC_X=x\nEXTENSION_SECRET=s3cr3t\nPLAIN=plain\n'

function project(entries: Record<string, string> = ENTRIES): string {
  const root = makeTempRoot('process')
  writeFiles(root, {
    '.env': ENV_FILE,
    ...Object.fromEntries(
      Object.entries(entries).map(([name, source]) => [`${name}.js`, source])
    )
  })

  return root
}

interface BuildOptions {
  mode: Mode
  entries?: string[]
  processShimPath?: string
  plugins?: Array<{apply: (compiler: Compiler) => void}>
}

async function build(root: string, options: BuildOptions) {
  const outputPath = path.join(root, 'out')
  // Nothing may land in the repo: the output is inside the run's temp folder.
  expect(
    path.relative(fs.realpathSync(os.tmpdir()), outputPath).startsWith('..')
  ).toBe(false)

  const names = options.entries || Object.keys(ENTRIES)
  const stats = await compile({
    context: root,
    outputPath,
    mode: options.mode,
    entry: Object.fromEntries(names.map((name) => [name, `./${name}.js`])),
    plugins: [
      new EnvPlugin({
        browser: 'chrome',
        processShimPath: options.processShimPath
      }),
      ...(options.plugins || [])
    ],
    // The ids and the minifier follow the real config, so the bytes do too.
    configure: (config) => {
      config.optimization = {
        ...config.optimization,
        minimize: options.mode === 'production',
        moduleIds: options.mode === 'production' ? 'natural' : 'deterministic'
      }
    }
  })

  return {
    stats,
    errors: messagesOf(stats, 'errors'),
    warnings: messagesOf(stats, 'warnings'),
    file: (name: string) => path.join(outputPath, `${name}.js`),
    bytes: (name: string) =>
      fs.readFileSync(path.join(outputPath, `${name}.js`))
  }
}

// The context has no process global, so every answer comes from the bundle.
async function run(file: string): Promise<string[] | string> {
  try {
    const logs = runScript(file)
    await new Promise((resolve) => setImmediate(resolve))

    return logs
  } catch (error) {
    return `throws ${(error as Error).name}: ${(error as Error).message}`
  }
}

const built = {} as Record<Mode, Awaited<ReturnType<typeof build>>>
const results = {} as Record<Mode, Record<string, string[] | string>>

beforeAll(async () => {
  // The shell running the suite must not leak a value into what is asserted.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EXTENSION_')) vi.stubEnv(key, undefined)
  }

  for (const mode of MODES) {
    built[mode] = await build(project(), {mode})
    results[mode] = {}

    for (const name of Object.keys(ENTRIES)) {
      results[mode][name] = await run(built[mode].file(name))
    }
  }
})

afterAll(() => {
  vi.unstubAllEnvs()
  removeTempRoots()
})

describe.each(MODES)('process in a %s bundle', (mode) => {
  it('builds every access pattern without an error or a warning', () => {
    expect(built[mode].errors).toEqual([])
    expect(built[mode].warnings).toEqual([])
  })

  it('inlines a dotted read, at the cost of the literal itself', () => {
    expect(results[mode].dotted).toEqual(['x'])
    expect(results[mode].none).toEqual(['none'])
    expect(built[mode].bytes('dotted')).toEqual(built[mode].bytes('literal'))
  })

  it('answers the members a browser bundle reads off process', () => {
    expect(results[mode].typeof).toEqual(['object'])
    expect(results[mode].platform).toEqual(['browser'])
    expect(results[mode].cwd).toEqual(['/'])
    expect(results[mode].nextTick).toEqual(['sync', 'tick 1 2'])
    expect(results[mode].mutate).toEqual(['x'])
    expect(results[mode].members).toEqual([
      JSON.stringify([[], '', {}, 'browser', true, 'browser', 0, 0, null, []]),
      Array.from({length: 9}, () => 'undefined').join()
    ])
  })

  // Pins today's behavior. Ledger 1394 D1.
  it('gives a whole-object process.env read none of the public values', () => {
    expect(results[mode].dynamic).toEqual(['undefined'])
    expect(results[mode].destructure).toEqual(['undefined'])
    expect(results[mode].whole).toEqual(['{}'])
    expect(results[mode].parity).toEqual(['false'])
  })

  it('never carries a variable that is not public', () => {
    expect(results[mode].secret).toEqual(['undefined undefined undefined'])

    for (const name of Object.keys(ENTRIES)) {
      const bundle = built[mode].bytes(name)

      expect(bundle.includes('s3cr3t')).toBe(false)
      expect(bundle.includes('plain')).toBe(false)
    }
  })
})

describe('process in a child compiler', () => {
  it.each(MODES)('answers a %s child compile the same way', async (mode) => {
    const root = project({
      none: ENTRIES.none,
      child:
        "const key = 'EXTENSION_PUBLIC_X'\nconsole.log(process.platform, process.env.EXTENSION_PUBLIC_X, process.env[key])\n"
    })
    const childPlugin = {
      apply(compiler: Compiler) {
        compiler.hooks.make.tapPromise('child', async (compilation) => {
          const child = compilation.createChildCompiler(
            'child',
            {filename: '[name].js'} as never,
            [new EntryPlugin(root, './child.js', {name: 'child'})]
          )
          await new Promise<void>((resolve, reject) =>
            child.runAsChild((error) => (error ? reject(error) : resolve()))
          )
        })
      }
    }
    const result = await build(root, {
      mode,
      entries: ['none'],
      plugins: [childPlugin]
    })

    expect(result.errors).toEqual([])
    // Pins today's behavior. Ledger 1394 D1.
    expect(await run(result.file('child'))).toEqual(['browser x undefined'])
  })
})

describe('process when the shim file is not where the plugin looks', () => {
  const missing = (root: string) => path.join(root, 'no-such-shim.cjs')

  // Pins today's behavior. Ledger 1394 D2.
  it('emits a development script that does not parse for a write to process.env', async () => {
    const root = project()
    const result = await build(root, {
      mode: 'development',
      entries: ['mutate'],
      processShimPath: missing(root)
    })

    expect(result.errors).toEqual([])
    expect(result.bytes('mutate').toString()).toContain("{}.FOO = 'x'")
    expect(await run(result.file('mutate'))).toBe(
      "throws SyntaxError: Unexpected token '.'"
    )
  })

  // Pins today's behavior. Ledger 1394 D2.
  it('fails the production build for a write to process.env', async () => {
    const root = project()
    const result = await build(root, {
      mode: 'production',
      entries: ['mutate'],
      processShimPath: missing(root)
    })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Chunk minification failed')
    expect(fs.existsSync(result.file('mutate'))).toBe(false)
  })

  // Pins today's behavior. Ledger 1394 D3.
  it.each(
    MODES
  )('says nothing in %s and answers with a smaller object', async (mode) => {
    const root = project()
    const result = await build(root, {
      mode,
      entries: ['platform', 'cwd', 'nextTick', 'members'],
      processShimPath: missing(root)
    })

    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(await run(result.file('platform'))).toEqual(['browser'])
    expect(await run(result.file('nextTick'))).toEqual([
      'sync',
      'tick undefined undefined'
    ])

    expect(await run(result.file('cwd'))).toMatch(
      /^throws TypeError: .*cwd is not a function$/
    )

    expect(await run(result.file('members'))).toMatch(
      /^throws TypeError: .*umask is not a function$/
    )
  })
})
