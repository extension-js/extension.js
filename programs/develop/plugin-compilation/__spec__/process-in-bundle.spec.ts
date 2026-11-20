import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {type Compiler, type Configuration, EntryPlugin} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {EnvPlugin} from '../env'
import {processModuleRequest, processModuleSource} from '../process-module'
import {
  compile,
  makeTempRoot,
  messagesOf,
  removeTempRoots,
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
  // A library that takes its Node branch on typeof process alone.
  nodeBranch:
    "if (typeof process === 'object') {\n" +
    '  const [s, ns] = process.hrtime()\n' +
    '  const elapsed = process.hrtime([s, ns])\n' +
    "  process.emitWarning('deprecated')\n" +
    '  console.log(JSON.stringify([typeof s, typeof ns, elapsed.length, typeof process.hrtime.bigint()]))\n' +
    '}\n',
  cwd: 'console.log(process.cwd())\n',
  // A logger or a color check that takes its Node branch reads the streams.
  streams:
    'const {stdout, stderr} = process\n' +
    'console.log(JSON.stringify([stdout.isTTY, stderr.isTTY, stdout.fd, stderr.fd, typeof stdout.columns, stdout.writable]))\n' +
    "let flushed = ''\n" +
    "console.log(stdout.write('out line\\n'), stderr.write('err line\\n', () => { flushed += 'a' }), stdout.write('partial', 'utf8', () => { flushed += 'b' }))\n" +
    'console.log(flushed, String(stdout.on("drain", () => {})), String(stderr.once("error", () => {})), String(stdout.end()))\n',
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
  plugins?: Array<{apply: (compiler: Compiler) => void}>
  configure?: (config: Configuration) => void
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
    plugins: [new EnvPlugin({browser: 'chrome'}), ...(options.plugins || [])],
    // The ids and the minifier follow the real config, so the bytes do too.
    configure: (config) => {
      config.optimization = {
        ...config.optimization,
        minimize: options.mode === 'production',
        moduleIds: options.mode === 'production' ? 'natural' : 'deterministic'
      }

      options.configure?.(config)
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

interface Run {
  logs: string[] | string
  // What the script left on the global object, beyond the console it was given.
  globals: string[]
}

// The context has no process global, so every answer comes from the bundle.
async function run(file: string): Promise<Run> {
  const logs: string[] = []
  const context = vm.createContext({
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' '))
    }
  })
  const globals = () =>
    Object.keys(context).filter((name) => name !== 'console')

  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file})
    await new Promise((resolve) => setImmediate(resolve))

    return {logs, globals: globals()}
  } catch (error) {
    return {
      logs: `throws ${(error as Error).name}: ${(error as Error).message}`,
      globals: globals()
    }
  }
}

const logsOf = async (file: string) => (await run(file)).logs

function publicEnv(mode: Mode, extra: Record<string, string> = {}) {
  return {
    EXTENSION_PUBLIC_X: 'x',
    ...extra,
    EXTENSION_PUBLIC_BROWSER: 'chrome',
    EXTENSION_PUBLIC_MODE: mode,
    EXTENSION_BROWSER: 'chrome',
    EXTENSION_MODE: mode,
    BROWSER: 'chrome',
    MODE: mode
  }
}

const built = {} as Record<Mode, Awaited<ReturnType<typeof build>>>
const results = {} as Record<Mode, Record<string, Run>>

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
  const logs = (name: string) => results[mode][name].logs

  it('builds every access pattern without an error or a warning', () => {
    expect(built[mode].errors).toEqual([])
    expect(built[mode].warnings).toEqual([])
  })

  it('inlines a dotted read, at the cost of the literal itself', () => {
    expect(logs('dotted')).toEqual(['x'])
    expect(logs('none')).toEqual(['none'])
    expect(built[mode].bytes('dotted')).toEqual(built[mode].bytes('literal'))
  })

  it('answers the members a browser bundle reads off process', () => {
    expect(logs('typeof')).toEqual(['object'])
    expect(logs('platform')).toEqual(['browser'])
    expect(logs('cwd')).toEqual(['/'])
    expect(logs('nextTick')).toEqual(['sync', 'tick 1 2'])
    expect(logs('mutate')).toEqual(['x'])
    expect(logs('nodeBranch')).toEqual([
      JSON.stringify(['number', 'number', 2, 'bigint'])
    ])

    expect(logs('streams')).toEqual([
      JSON.stringify([false, false, 1, 2, 'number', true]),
      'out line',
      'err line',
      'partial',
      'true true true',
      'ab undefined undefined undefined'
    ])

    expect(logs('members')).toEqual([
      JSON.stringify([[], '', {}, 'browser', true, 'browser', 0, 0, null, []]),
      Array.from({length: 9}, () => 'undefined').join()
    ])
  })

  it('gives a whole-object process.env read the keys import.meta.env has', () => {
    expect(logs('dynamic')).toEqual(['x'])
    expect(logs('destructure')).toEqual(['x'])
    expect(logs('whole')).toEqual([JSON.stringify(publicEnv(mode))])
    expect(logs('parity')).toEqual(['true'])
  })

  it('never carries a variable that is not public', () => {
    expect(logs('secret')).toEqual(['undefined undefined undefined'])

    for (const name of Object.keys(ENTRIES)) {
      const bundle = built[mode].bytes(name)

      expect(bundle.includes('s3cr3t')).toBe(false)
      expect(bundle.includes('plain')).toBe(false)
    }
  })

  it('leaves nothing on the global object and runs under a strict CSP', () => {
    for (const name of Object.keys(ENTRIES)) {
      const bundle = built[mode].bytes(name).toString()

      expect(results[mode][name].globals).toEqual([])
      expect(bundle).not.toMatch(/\beval\s*\(|\bFunction\s*\(/)
    }
  })

  it('adds the module once, and only to a bundle that reads process', () => {
    const cost =
      built[mode].bytes('platform').length - built[mode].bytes('none').length

    expect(built[mode].bytes('dotted').includes('nextTick')).toBe(false)
    expect(
      built[mode].bytes('platform').toString().split('nextTick')
    ).toHaveLength(2)

    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(mode === 'production' ? 1536 : 2560)
  })
})

describe('process across the files of one build', () => {
  it.each(
    MODES
  )('hands a %s service worker, content script and page equal objects', async (mode) => {
    const read =
      'console.log(JSON.stringify([process.env, Object.keys(process), process.platform, process.cwd()]))\n'
    const root = project({
      'background/service_worker': read,
      'content_scripts/content-0': read,
      'action/index': read
    })
    const names = [
      'background/service_worker',
      'content_scripts/content-0',
      'action/index'
    ]
    const result = await build(root, {mode, entries: names})
    const answers = await Promise.all(
      names.map((name) => logsOf(result.file(name)))
    )

    expect(result.errors).toEqual([])
    expect(answers[0]).toEqual([
      JSON.stringify([
        publicEnv(mode),
        Object.keys(moduleExports(publicEnv(mode))),
        'browser',
        '/'
      ])
    ])

    expect(answers[1]).toEqual(answers[0])
    expect(answers[2]).toEqual(answers[0])
  })

  it.each(
    MODES
  )('shares one object between the modules of a %s bundle', async (mode) => {
    const root = project({
      page: "import './writer.js'\nimport './reader.js'\n",
      writer: "process.env.SHARED = 'written'\n",
      reader: "const key = 'SHARED'\nconsole.log(process.env[key])\n"
    })
    const result = await build(root, {mode, entries: ['page']})

    expect(result.errors).toEqual([])
    expect(await logsOf(result.file('page'))).toEqual(['written'])
  })

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
    expect(await run(result.file('child'))).toEqual({
      logs: ['browser x x'],
      globals: []
    })
  })
})

// Runs the generated module on its own and returns what it exports.
function moduleExports(env: Record<string, string>): Record<string, unknown> {
  const module = {exports: {}}
  new Function('module', processModuleSource(env))(module)

  return module.exports
}

describe('process with values that fight the encoding', () => {
  const hostile =
    'a"b\'c<d>%41%ZZ#e?f!g\nh\u00e9\u2028\\i&j+k l;m=n`o$' +
    '{p}</script> logo.svg style.css \ud83d\ude00'

  it.each(
    MODES
  )('carries a hostile value whole in %s, past a rule that matches by name', async (mode) => {
    vi.stubEnv('EXTENSION_PUBLIC_HOSTILE', hostile)

    try {
      const root = project({
        hostile:
          "const key = 'EXTENSION_PUBLIC_HOSTILE'\nconsole.log(JSON.stringify([process.env[key], import.meta.env[key], process.env.EXTENSION_PUBLIC_HOSTILE]))\n"
      })
      const result = await build(root, {
        mode,
        entries: ['hostile'],
        // A project's own loose rule must not take the module for an asset.
        configure: (config) => {
          config.module = {
            rules: [
              {test: /\.svg/, type: 'asset/resource'},
              {test: /\.css/, type: 'asset/source'}
            ]
          }
        }
      })

      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
      expect(await logsOf(result.file('hostile'))).toEqual([
        JSON.stringify([hostile, hostile, hostile])
      ])
    } finally {
      vi.stubEnv('EXTENSION_PUBLIC_HOSTILE', undefined)
    }
  })

  it('writes source that is plain ASCII and a request that is plain base64', () => {
    const env = publicEnv('development', {EXTENSION_PUBLIC_HOSTILE: hostile})
    const source = processModuleSource(env)
    const [head, body] = processModuleRequest(env).split(',')

    expect(source).toMatch(/^[\x20-\x7e]+$/)
    expect(source).not.toContain('</script>')
    expect(moduleExports(env).env).toEqual(env)
    expect(head).toBe('data:application/node;base64')
    expect(body).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(Buffer.from(body, 'base64').toString()).toBe(source)
  })
})

describe('process in source maps', () => {
  it.each([
    ['development', 'cheap-module-source-map'],
    ['production', 'source-map']
  ] as const)('names the %s module by its request and no folder of this machine', async (mode, devtool) => {
    const root = project()
    const result = await build(root, {
      mode,
      entries: ['dynamic'],
      configure: (config) => {
        config.devtool = devtool
      }
    })
    const map = fs.readFileSync(`${result.file('dynamic')}.map`, 'utf8')
    const {sources, sourcesContent} = JSON.parse(map) as {
      sources: string[]
      sourcesContent: string[]
    }
    const request = processModuleRequest(publicEnv(mode))

    expect(result.errors).toEqual([])
    expect(sources.filter((source) => source.startsWith('data:'))).toEqual([
      request
    ])

    expect(sourcesContent[sources.indexOf(request)]).toBe(
      processModuleSource(publicEnv(mode))
    )

    for (const text of [map, result.bytes('dynamic').toString()]) {
      expect(text).not.toContain(root)
      expect(text).not.toContain(os.homedir())
      expect(text).not.toContain(path.resolve(__dirname, '..', '..'))
      expect(text).not.toContain('node_modules')
    }
  })
})
