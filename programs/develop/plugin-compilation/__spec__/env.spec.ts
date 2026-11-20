import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, EntryPlugin, type Stats} from '@rspack/core'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getPreloadedEnvKeys} from '../../lib/config-loader'
import {getCurrentManifestContent} from '../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {
  EnvPlugin,
  getEnvFileLayers,
  IMPORT_META_URL_RUNTIME,
  importMetaUrlForEmitPath,
  toJsStringLiteral
} from '../env'
import {
  type CompileOptions,
  compile,
  createCompiler,
  makeTempRoot,
  removeTempRoots,
  runScript,
  writeFiles
} from './helpers/real-compile'

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')

// rspack frames a warning with a glyph and a gutter, which is not the text.
const plainMessage = (value: string) =>
  stripAnsi(value)
    .split('\n')
    .map((line) => line.replace(/^\s*[\u26a0\u2502] ?/, ''))
    .join('\n')
    .trim()

const LOG_PUBLIC = 'console.log(process.env.EXTENSION_PUBLIC_FOO)\n'

interface BuildOptions {
  context?: string
  browser?: 'chrome' | 'firefox' | 'edge'
  mode?: 'development' | 'production'
  copy?: string[]
  extraPlugins?: Array<{apply: (compiler: Compiler) => void}>
  // Runs the first build of a watch, where the env files are tracked.
  watch?: boolean
}

// The first build of a watch, closed once it is done.
async function firstWatchBuild(compiler: Compiler): Promise<Stats> {
  const stats = await new Promise<Stats>((resolve, reject) => {
    const watching = compiler.watch({aggregateTimeout: 20}, (error, result) => {
      watching.close(() => {
        if (error || !result) reject(error || new Error('no stats'))
        else resolve(result)
      })
    })
  })

  await new Promise<void>((resolve) => compiler.close(() => resolve()))

  return stats
}

async function build(root: string, options: BuildOptions = {}) {
  const context = options.context || root
  const outputPath = path.join(root, 'out')
  const compileOptions: CompileOptions = {
    context,
    outputPath,
    mode: options.mode || 'development',
    entry: {background: './background.js'},
    copy: options.copy,
    plugins: [
      new EnvPlugin({
        manifestPath: path.join(context, 'manifest.json'),
        browser: options.browser || 'chrome'
      }),
      ...(options.extraPlugins || [])
    ]
  }
  const stats: Stats = options.watch
    ? await firstWatchBuild(createCompiler(compileOptions))
    : await compile(compileOptions)

  return {
    stats,
    errors: Array.from(stats.compilation.errors, (error) => ({
      name: error.name,
      file: (error as {file?: string}).file,
      message: error.message
    })),
    warnings: Array.from(stats.compilation.warnings, (warning) => ({
      name: warning.name,
      message: plainMessage(warning.message)
    })),
    // Read from the compilation, so an asset held back by an error is visible.
    asset: (name: string) =>
      String(stats.compilation.getAsset(name)?.source.source() ?? ''),
    logs: (globals?: Record<string, unknown>) =>
      runScript(path.join(outputPath, 'background.js'), globals)
  }
}

function project(files: Record<string, string>, entry = LOG_PUBLIC) {
  const root = makeTempRoot('env')
  writeFiles(root, {
    'manifest.json': '{"name":"env"}',
    'background.js': entry,
    ...files
  })

  return root
}

beforeEach(() => {
  // The shell running the suite must not leak a value into what is asserted.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EXTENSION_')) vi.stubEnv(key, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(() => {
  removeTempRoots()
})

describe('EnvPlugin env file selection', () => {
  it('lets the most specific env file that exists win, in the family order', async () => {
    const order = [
      '.env.chrome.development',
      '.env.chrome',
      '.env.chromium.development',
      '.env.chromium',
      '.env.edge.development',
      '.env.edge',
      '.env.chromium-based.development',
      '.env.chromium-based',
      '.env.development.local',
      '.env.development',
      '.env.local',
      '.env'
    ]
    const root = project(
      {
        '.env.defaults':
          'EXTENSION_PUBLIC_FOO=.env.defaults\nEXTENSION_PUBLIC_BASE=base\n',
        '.env.firefox': 'EXTENSION_PUBLIC_FOO=.env.firefox\n',
        '.env.production': 'EXTENSION_PUBLIC_FOO=.env.production\n',
        '.env.example': 'EXTENSION_PUBLIC_FOO=.env.example\n',
        ...Object.fromEntries(
          order.map((file) => [file, `EXTENSION_PUBLIC_FOO=${file}\n`])
        )
      },
      'console.log(process.env.EXTENSION_PUBLIC_FOO, import.meta.env.EXTENSION_PUBLIC_BASE)\n'
    )
    const picked: string[] = []

    for (const file of order) {
      picked.push((await build(root)).logs()[0])
      fs.rmSync(path.join(root, file))
    }

    expect(picked).toEqual(order.map((file) => `${file} base`))
    // No candidate left: the defaults layer alone, never .env.example.
    expect((await build(root)).logs()).toEqual(['.env.defaults base'])
  })

  it('reads the production candidates for a production build', async () => {
    const root = project({
      '.env.chrome.development': 'EXTENSION_PUBLIC_FOO=dev\n',
      '.env.production': 'EXTENSION_PUBLIC_FOO=prod\n',
      '.env.local': 'EXTENSION_PUBLIC_FOO=local\n'
    })

    expect((await build(root, {mode: 'production'})).logs()).toEqual(['prod'])
  })

  it('lets a genuine shell value outrank an env file and the defaults', async () => {
    const root = project(
      {
        '.env.defaults':
          'EXTENSION_PUBLIC_A=defaults\nEXTENSION_PUBLIC_B=defaults\n',
        '.env': 'EXTENSION_PUBLIC_B=file\nEXTENSION_PUBLIC_C=file\n',
        'manifest.json':
          '{"a":"$EXTENSION_PUBLIC_A","b":"$EXTENSION_PUBLIC_B","c":"$EXTENSION_PUBLIC_C"}'
      },
      'console.log(process.env.EXTENSION_PUBLIC_A, process.env.EXTENSION_PUBLIC_B, process.env.EXTENSION_PUBLIC_C)\n'
    )
    vi.stubEnv('EXTENSION_PUBLIC_C', 'shell')
    const result = await build(root, {copy: ['manifest.json']})

    expect(result.logs()).toEqual(['defaults file shell'])
    expect(result.asset('manifest.json')).toBe(
      '{"a":"defaults","b":"file","c":"shell"}'
    )
  })

  // dotenv.config in the config loader mutates process.env, and the merge
  // treats process.env as the shell layer, so a preloaded key steps back.
  it('keeps a preloaded .env.defaults key from outranking a stronger env file', async () => {
    const root = project({
      '.env.defaults': 'EXTENSION_PUBLIC_FOO=defFoo\n',
      '.env.chrome.development': 'EXTENSION_PUBLIC_FOO=envFoo\n'
    })
    vi.stubEnv('EXTENSION_PUBLIC_FOO', 'defFoo')
    const preloaded = getPreloadedEnvKeys() as Set<string>
    preloaded.add('EXTENSION_PUBLIC_FOO')

    try {
      expect((await build(root)).logs()).toEqual(['envFoo'])
    } finally {
      preloaded.delete('EXTENSION_PUBLIC_FOO')
    }
  })

  it('falls back to the nearest workspace root env file', async () => {
    const root = makeTempRoot('env-workspace')
    writeFiles(root, {
      'pnpm-workspace.yaml': "packages: ['packages/*']\n",
      '.env':
        'EXTENSION_PUBLIC_ROOT_ONLY=rootOnly\nEXTENSION_BAR=rootBar\nEXTENSION_PUBLIC_FOO=rootFoo\n',
      'packages/ext/manifest.json':
        '{"name":"$EXTENSION_PUBLIC_ROOT_ONLY","desc":"$EXTENSION_BAR"}',
      'packages/ext/background.js':
        'console.log(process.env.EXTENSION_PUBLIC_ROOT_ONLY, import.meta.env.EXTENSION_PUBLIC_ROOT_ONLY)\n'
    })

    const result = await build(root, {
      context: path.join(root, 'packages', 'ext'),
      copy: ['manifest.json']
    })

    expect(result.logs()).toEqual(['rootOnly rootOnly'])
    expect(result.asset('manifest.json')).toBe(
      '{"name":"rootOnly","desc":"$EXTENSION_BAR"}'
    )
  })

  it('still reaches the workspace root when the package has only .env.defaults', async () => {
    const root = makeTempRoot('env-workspace-defaults')
    writeFiles(root, {
      'pnpm-workspace.yaml': "packages: ['packages/*']\n",
      '.env': 'EXTENSION_PUBLIC_ROOT_ONLY=rootOnly\n',
      '.env.defaults':
        'EXTENSION_PUBLIC_D1=rootDefault\nEXTENSION_PUBLIC_D2=rootDefault\n',
      'packages/ext/.env.defaults': 'EXTENSION_PUBLIC_D1=localDefault\n',
      'packages/ext/manifest.json': '{}',
      'packages/ext/background.js':
        'console.log(process.env.EXTENSION_PUBLIC_ROOT_ONLY, process.env.EXTENSION_PUBLIC_D1, process.env.EXTENSION_PUBLIC_D2)\n'
    })

    const result = await build(root, {
      context: path.join(root, 'packages', 'ext')
    })

    expect(result.logs()).toEqual(['rootOnly localDefault rootDefault'])
  })
})

describe('EnvPlugin env file layers', () => {
  it('keeps a key only in .env when .env.production also exists', async () => {
    const root = project(
      {
        '.env':
          'EXTENSION_PUBLIC_FOO=dotenv\nEXTENSION_PUBLIC_ONLY=dotenv-only\n',
        '.env.production': 'EXTENSION_PUBLIC_FOO=production\n'
      },
      'console.log(process.env.EXTENSION_PUBLIC_FOO, process.env.EXTENSION_PUBLIC_ONLY)\n'
    )

    expect((await build(root, {mode: 'production'})).logs()).toEqual([
      'production dotenv-only'
    ])
  })

  // File N sets keys N and up, so key N is contested by every file up to N
  // and reads the name of the file that won it.
  it('merges every layer weakest first, key by key', async () => {
    const weakestFirst = [
      '.env.defaults',
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
      '.env.chromium-based',
      '.env.chromium-based.development',
      '.env.edge',
      '.env.edge.development',
      '.env.chromium',
      '.env.chromium.development',
      '.env.chrome',
      '.env.chrome.development'
    ]
    const keys = weakestFirst.map((_, index) => `EXTENSION_PUBLIC_K${index}`)
    const root = project(
      {
        '.env.production': keys
          .map((key) => `${key}=.env.production\n`)
          .join(''),
        '.env.firefox': keys.map((key) => `${key}=.env.firefox\n`).join(''),
        ...Object.fromEntries(
          weakestFirst.map((file, index) => [
            file,
            keys
              .slice(index)
              .map((key) => `${key}=${file}\n`)
              .join('')
          ])
        )
      },
      `console.log(${keys.map((key) => `process.env.${key}`).join(', ')})\n`
    )

    expect(getEnvFileLayers('chrome', 'development')).toEqual(weakestFirst)
    expect((await build(root)).logs()).toEqual([weakestFirst.join(' ')])
  })

  it('reads the mode file of the running mode and never the other one', async () => {
    const root = project(
      {
        '.env': 'EXTENSION_PUBLIC_FOO=dotenv\n',
        '.env.development':
          'EXTENSION_PUBLIC_FOO=development\nEXTENSION_PUBLIC_DEV=dev-only\n',
        '.env.production':
          'EXTENSION_PUBLIC_FOO=production\nEXTENSION_PUBLIC_PROD=prod-only\n'
      },
      'console.log(process.env.EXTENSION_PUBLIC_FOO, process.env.EXTENSION_PUBLIC_DEV, process.env.EXTENSION_PUBLIC_PROD)\n'
    )

    expect((await build(root)).logs()).toEqual([
      'development dev-only undefined'
    ])

    expect((await build(root, {mode: 'production'})).logs()).toEqual([
      'production undefined prod-only'
    ])
  })

  it('lets a shell value outrank every layer', async () => {
    const root = project({
      '.env.defaults': 'EXTENSION_PUBLIC_FOO=defaults\n',
      '.env': 'EXTENSION_PUBLIC_FOO=dotenv\n',
      '.env.local': 'EXTENSION_PUBLIC_FOO=local\n',
      '.env.development': 'EXTENSION_PUBLIC_FOO=development\n',
      '.env.chrome.development': 'EXTENSION_PUBLIC_FOO=chrome\n'
    })
    vi.stubEnv('EXTENSION_PUBLIC_FOO', 'shell')

    expect((await build(root)).logs()).toEqual(['shell'])
  })

  it('fills JSON and HTML placeholders from the same layered values', async () => {
    const root = project({
      '.env.defaults': 'EXTENSION_PUBLIC_BASE=defaults\n',
      '.env':
        'EXTENSION_PUBLIC_FOO=dotenv\nEXTENSION_PUBLIC_ONLY=dotenv-only\n',
      '.env.local': 'EXTENSION_PUBLIC_LOCAL=local\n',
      '.env.production': 'EXTENSION_PUBLIC_FOO=production\n',
      'manifest.json':
        '{"a":"$EXTENSION_PUBLIC_BASE","b":"$EXTENSION_PUBLIC_ONLY","c":"$EXTENSION_PUBLIC_LOCAL","d":"$EXTENSION_PUBLIC_FOO"}',
      'index.html':
        '<p>$EXTENSION_PUBLIC_BASE $EXTENSION_PUBLIC_ONLY $EXTENSION_PUBLIC_LOCAL $EXTENSION_PUBLIC_FOO</p>'
    })
    const result = await build(root, {
      mode: 'production',
      copy: ['manifest.json', 'index.html']
    })

    expect(result.asset('manifest.json')).toBe(
      '{"a":"defaults","b":"dotenv-only","c":"local","d":"production"}'
    )

    expect(result.asset('index.html')).toBe(
      '<p>defaults dotenv-only local production</p>'
    )

    expect(result.warnings).toEqual([])
  })

  it('warns about a private or secret-looking name from a weaker layer', async () => {
    const root = project({
      '.env':
        'EXTENSION_SECRET_TOKEN=file-secret\nEXTENSION_PUBLIC_API_KEY=shipped-key\n',
      '.env.production': 'EXTENSION_PUBLIC_FOO=production\n',
      'manifest.json': '{"key":"$EXTENSION_SECRET_TOKEN"}'
    })
    const result = await build(root, {
      mode: 'production',
      copy: ['manifest.json']
    })

    expect(result.asset('manifest.json')).toBe(
      '{"key":"$EXTENSION_SECRET_TOKEN"}'
    )

    expect(result.warnings.map((warning) => warning.name)).toEqual([
      'EnvPublicSecretName',
      'EnvPrivatePlaceholder'
    ])

    expect(JSON.stringify(result.warnings)).not.toMatch(
      /file-secret|shipped-key/
    )
  })

  it('tracks each layer as a dependency under a watch, present or missing', async () => {
    const root = project({'.env': 'EXTENSION_PUBLIC_FOO=dotenv\n'})
    const dependencies = (result: Awaited<ReturnType<typeof build>>) => ({
      file: [...result.stats.compilation.fileDependencies]
        .filter((file) => path.basename(file).startsWith('.env'))
        .map((file) => path.relative(root, file))
        .sort(),
      missing: [...result.stats.compilation.missingDependencies]
        .filter((file) => path.basename(file).startsWith('.env'))
        .map((file) => path.relative(root, file))
        .sort()
    })
    const first = await build(root, {mode: 'production', watch: true})

    expect(first.logs()).toEqual(['dotenv'])
    expect(dependencies(first)).toEqual({
      file: ['.env'],
      missing: [
        '.env.chrome',
        '.env.chrome.production',
        '.env.chromium',
        '.env.chromium-based',
        '.env.chromium-based.production',
        '.env.chromium.production',
        '.env.defaults',
        '.env.edge',
        '.env.edge.production',
        '.env.local',
        '.env.production',
        '.env.production.local'
      ]
    })

    writeFiles(root, {'.env.local': 'EXTENSION_PUBLIC_FOO=local\n'})
    const second = await build(root, {mode: 'production', watch: true})

    expect(second.logs()).toEqual(['local'])
    expect(dependencies(second).file).toEqual(['.env', '.env.local'])
    expect(dependencies(second).missing).not.toContain('.env.local')
  })

  it('layers the workspace root files when the package has none', async () => {
    const root = makeTempRoot('env-workspace-layers')
    writeFiles(root, {
      'pnpm-workspace.yaml': "packages: ['packages/*']\n",
      '.env':
        'EXTENSION_PUBLIC_FOO=rootDotenv\nEXTENSION_PUBLIC_ONLY=rootOnly\n',
      '.env.development': 'EXTENSION_PUBLIC_FOO=rootDevelopment\n',
      'packages/ext/manifest.json': '{}',
      'packages/ext/background.js':
        'console.log(process.env.EXTENSION_PUBLIC_FOO, process.env.EXTENSION_PUBLIC_ONLY)\n'
    })

    const context = path.join(root, 'packages', 'ext')
    const result = await build(root, {context, watch: true})

    expect(result.logs()).toEqual(['rootDevelopment rootOnly'])
    // A file written at either level later has to count as a change.
    expect([...result.stats.compilation.missingDependencies]).toEqual(
      expect.arrayContaining([
        path.join(context, '.env.local'),
        path.join(root, '.env.local')
      ])
    )
  })

  it('still asks for a rename only when no layer but the defaults matched', async () => {
    const root = project({
      '.env.defaults': 'EXTENSION_PUBLIC_FOO=defaults\n',
      '.env.staging': 'EXTENSION_PUBLIC_FOO=staging\n'
    })

    expect((await build(root)).warnings.map((warning) => warning.name)).toEqual(
      ['EnvNoMatchingFile']
    )

    writeFiles(root, {'.env': 'EXTENSION_PUBLIC_FOO=dotenv\n'})

    expect((await build(root)).warnings).toEqual([])
  })
})

describe('EnvPlugin names reserved for the build target', () => {
  it('names a reserved name an env file sets, and the file, never the value', async () => {
    const root = project(
      {
        '.env':
          'EXTENSION_PUBLIC_MODE=staging-one\nEXTENSION_PUBLIC_BROWSER=netscape\nEXTENSION_MODE=staging-two\nMODE=other-tool\n',
        '.env.development': 'EXTENSION_PUBLIC_MODE=staging-three\n',
        'manifest.json':
          '{"mode":"$EXTENSION_PUBLIC_MODE","browser":"$EXTENSION_PUBLIC_BROWSER"}'
      },
      'console.log(process.env.EXTENSION_PUBLIC_MODE, import.meta.env.EXTENSION_PUBLIC_BROWSER, process.env.EXTENSION_MODE, process.env.MODE)\n'
    )
    const result = await build(root, {copy: ['manifest.json']})

    expect(result.logs()).toEqual([
      'development chrome development development'
    ])

    expect(result.asset('manifest.json')).toBe(
      '{"mode":"development","browser":"chrome"}'
    )

    expect(result.warnings).toEqual([
      {
        name: 'EnvReservedName',
        message:
          'EXTENSION_MODE in .env is reserved for the build target, so the file value is ignored.\n' +
          'EXTENSION_PUBLIC_BROWSER in .env is reserved for the build target, so the file value is ignored.\n' +
          'EXTENSION_PUBLIC_MODE in .env.development is reserved for the build target, so the file value is ignored.\n' +
          'The build sets the browser and mode names itself, from the target it compiles for. Use another name for a value of your own.'
      }
    ])
  })

  it('stays quiet when the file value already is the build target', async () => {
    const root = project({
      '.env':
        'EXTENSION_PUBLIC_MODE=development\nEXTENSION_PUBLIC_BROWSER=chrome\n'
    })

    expect((await build(root)).warnings).toEqual([])
  })
})

describe('EnvPlugin values in JavaScript', () => {
  it('gives JavaScript only EXTENSION_PUBLIC_* values and the build target', async () => {
    const root = project(
      {
        '.env':
          'EXTENSION_PUBLIC_OK=ok\nEXTENSION_SECRET_TOKEN=secret\nPLAIN=plain\n'
      },
      [
        'console.log(process.env.EXTENSION_PUBLIC_OK, import.meta.env.EXTENSION_PUBLIC_OK)',
        'console.log(process.env.EXTENSION_SECRET_TOKEN, import.meta.env.EXTENSION_SECRET_TOKEN, process.env.PLAIN)',
        'console.log(JSON.stringify(import.meta.env))',
        ''
      ].join('\n')
    )
    const result = await build(root, {browser: 'edge'})

    expect(result.logs()).toEqual([
      'ok ok',
      'undefined undefined undefined',
      JSON.stringify({
        EXTENSION_PUBLIC_OK: 'ok',
        EXTENSION_PUBLIC_BROWSER: 'edge',
        EXTENSION_PUBLIC_MODE: 'development',
        EXTENSION_BROWSER: 'edge',
        EXTENSION_MODE: 'development',
        BROWSER: 'edge',
        MODE: 'development'
      })
    ])

    expect(
      fs.readFileSync(path.join(root, 'out/background.js'), 'utf8')
    ).not.toContain('secret')
  })

  it('neutralizes Node-only import.meta fields and keeps file: URLs out', async () => {
    const root = project(
      {},
      'console.log(import.meta.dirname, import.meta.filename, import.meta.url)\n'
    )
    const result = await build(root)
    const bundle = fs.readFileSync(path.join(root, 'out/background.js'), 'utf8')

    expect(bundle).not.toContain('file:')
    expect(
      result.logs({
        self: {location: {href: 'chrome-extension://abc/background.js'}},
        chrome: {runtime: {getURL: (p: string) => `chrome-extension://abc${p}`}}
      })
    ).toEqual(['undefined undefined chrome-extension://abc/background.js'])
  })

  it('leaves import.meta.url in a child compiler to that compiler', async () => {
    const root = project({'child.js': 'console.log(import.meta.url)\n'})
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
    const result = await build(root, {extraPlugins: [childPlugin]})

    // The parent define stays on the parent: the child keeps rspack's own value.
    // rspack spells the URL its own way on Windows (short names, no escapes).
    expect(result.asset('child.js')).toMatch(/'file:\/\/[^']*\/child\.js'/)

    expect(result.asset('background.js')).not.toContain('file:')
  })
})

describe('EnvPlugin placeholders in emitted .json and .html', () => {
  it('replaces public names and leaves other files, private and unknown names', async () => {
    const root = project({
      '.env': 'EXTENSION_PUBLIC_FOO=envFoo\nEXTENSION_BAR=envBar\n',
      'index.html':
        '<meta content="$EXTENSION_PUBLIC_FOO"><p>$EXTENSION_BAR $EXTENSION_MISS</p>',
      'manifest.json':
        '{"name":"$EXTENSION_PUBLIC_FOO","desc":"$EXTENSION_BAR"}',
      'notes.txt': '$EXTENSION_PUBLIC_FOO'
    })
    const result = await build(root, {
      copy: ['index.html', 'manifest.json', 'notes.txt']
    })

    expect(result.asset('index.html')).toBe(
      '<meta content="envFoo"><p>$EXTENSION_BAR $EXTENSION_MISS</p>'
    )

    expect(result.asset('manifest.json')).toBe(
      '{"name":"envFoo","desc":"$EXTENSION_BAR"}'
    )

    expect(result.asset('notes.txt')).toBe('$EXTENSION_PUBLIC_FOO')
    // Later manifest steps read the substituted text, not the authored one.
    expect(getCurrentManifestContent(result.stats.compilation)).toBe(
      '{"name":"envFoo","desc":"$EXTENSION_BAR"}'
    )
  })

  it('escapes a quote, a backslash and a < for the json and html sinks', async () => {
    const hostile = 'A "great" C:\\path <b> & it\'s'
    vi.stubEnv('EXTENSION_PUBLIC_HOSTILE', hostile)
    const root = project({
      'manifest.json': '{"description":"$EXTENSION_PUBLIC_HOSTILE"}',
      '_locales/en/messages.json':
        '{"name":{"message":"Name $EXTENSION_PUBLIC_HOSTILE"}}',
      'index.html': [
        '<head><title>$EXTENSION_PUBLIC_HOSTILE</title>',
        '<script src="$EXTENSION_PUBLIC_HOSTILE"></script>',
        '<script>window.X="$EXTENSION_PUBLIC_HOSTILE";window.Y=\'$EXTENSION_PUBLIC_HOSTILE\'</script></head>',
        '<div id="root" title="$EXTENSION_PUBLIC_HOSTILE">$EXTENSION_PUBLIC_HOSTILE</div>'
      ].join('')
    })
    const result = await build(root, {
      copy: ['manifest.json', '_locales/en/messages.json', 'index.html']
    })

    expect(result.errors).toEqual([])
    expect(JSON.parse(result.asset('manifest.json')).description).toBe(hostile)
    expect(
      JSON.parse(result.asset('_locales/en/messages.json')).name.message
    ).toBe(`Name ${hostile}`)

    const entity = 'A &quot;great&quot; C:\\path &lt;b&gt; &amp; it&#39;s'
    const html = result.asset('index.html')
    expect(html).toContain(`<title>${entity}</title>`)
    expect(html).toContain(`<script src="${entity}"></script>`)
    expect(html).toContain(`<div id="root" title="${entity}">${entity}</div>`)

    const open = html.indexOf('<script>') + '<script>'.length
    const inline = html.slice(open, html.indexOf('</script>', open))
    expect(inline).not.toContain('<')
    const scope: {X?: string; Y?: string} = {}
    new Function('window', inline)(scope)
    expect(scope).toEqual({X: hostile, Y: hostile})
  })

  it('does not re-substitute a value that itself names a placeholder', async () => {
    vi.stubEnv('EXTENSION_PUBLIC_HOSTILE', 'keep $EXTENSION_PUBLIC_FOO')
    vi.stubEnv('EXTENSION_PUBLIC_FOO', 'foo')
    const root = project({
      'manifest.json': '{"name":"$EXTENSION_PUBLIC_HOSTILE"}'
    })
    const result = await build(root, {copy: ['manifest.json']})

    expect(result.asset('manifest.json')).toBe(
      '{"name":"keep $EXTENSION_PUBLIC_FOO"}'
    )
  })

  it('names the var and the asset when a value lands outside a JSON string', async () => {
    vi.stubEnv('EXTENSION_PUBLIC_FOO', 'sysFoo')
    const root = project({
      'manifest.json':
        '{"count":$EXTENSION_PUBLIC_FOO,"mode":"$EXTENSION_MODE"}',
      'ok.json': '{"count":"$EXTENSION_PUBLIC_FOO"}'
    })
    const result = await build(root, {copy: ['manifest.json', 'ok.json']})

    expect(result.asset('manifest.json')).toBe(
      '{"count":sysFoo,"mode":"development"}'
    )

    expect(result.asset('ok.json')).toBe('{"count":"sysFoo"}')
    expect(result.errors).toEqual([
      {
        name: 'EnvValueBreaksJsonAsset',
        file: 'manifest.json',
        message:
          '  × manifest.json is not valid JSON after substituting $EXTENSION_PUBLIC_FOO, $EXTENSION_MODE.\n' +
          '  │ Quote the placeholder to get a JSON string: "$EXTENSION_PUBLIC_FOO". ' +
          'An unquoted placeholder takes the value as written, so the value must be JSON itself.\n'
      }
    ])
  })

  it('does not blame the value for a file that was never strict JSON', async () => {
    vi.stubEnv('EXTENSION_PUBLIC_FOO', 'sysFoo')
    const root = project({
      'config.json':
        '{\n  // a comment the "loader" strips\n  "api": "$EXTENSION_PUBLIC_FOO"\n}'
    })
    const result = await build(root, {copy: ['config.json']})

    expect(result.errors).toEqual([])
    expect(result.asset('config.json')).toBe(
      '{\n  // a comment the "loader" strips\n  "api": "sysFoo"\n}'
    )
  })

  it('inserts an unquoted JSON value as written', async () => {
    vi.stubEnv('EXTENSION_PUBLIC_HOSTILE', '{"a":"</script>"}')
    const root = project({
      'config.json':
        '{"cfg": $EXTENSION_PUBLIC_HOSTILE, "text": "$EXTENSION_PUBLIC_HOSTILE"}',
      'sandbox.html':
        '<script>/* it\'s */ window.CFG = $EXTENSION_PUBLIC_HOSTILE; window.S = `${"$EXTENSION_PUBLIC_HOSTILE"}`</script><p>after</p>'
    })
    const result = await build(root, {copy: ['config.json', 'sandbox.html']})

    expect(result.errors).toEqual([])
    expect(JSON.parse(result.asset('config.json'))).toEqual({
      cfg: {a: '</script>'},
      text: '{"a":"</script>"}'
    })

    const html = result.asset('sandbox.html')
    const open = '<script>'.length
    const close = html.indexOf('</script>')
    expect(html.slice(close)).toBe('</script><p>after</p>')

    const scope: {CFG?: unknown; S?: string} = {}
    new Function('window', html.slice(open, close))(scope)
    expect(scope).toEqual({CFG: {a: '</script>'}, S: '{"a":"</script>"}'})
  })

  it('substitutes build-target synthetics so manifest and html match runtime', async () => {
    // The build target wins over a shell value, in assets and in code.
    vi.stubEnv('EXTENSION_BROWSER', 'chrome')
    vi.stubEnv('EXTENSION_PUBLIC_BROWSER', 'chrome')
    const root = project(
      {
        'manifest.json':
          '{"name":"My Ext ($EXTENSION_BROWSER)","browser":"$EXTENSION_PUBLIC_BROWSER","mode":"$EXTENSION_MODE"}',
        'index.html':
          '<title>$EXTENSION_PUBLIC_BROWSER</title><p>$EXTENSION_PUBLIC_MODE</p>'
      },
      'console.log(process.env.EXTENSION_BROWSER, import.meta.env.EXTENSION_PUBLIC_BROWSER, process.env.EXTENSION_MODE)\n'
    )
    const result = await build(root, {
      browser: 'firefox',
      mode: 'production',
      copy: ['manifest.json', 'index.html']
    })

    expect(result.asset('manifest.json')).toBe(
      '{"name":"My Ext (firefox)","browser":"firefox","mode":"production"}'
    )

    expect(result.asset('index.html')).toBe(
      '<title>firefox</title><p>production</p>'
    )

    expect(result.logs()).toEqual(['firefox firefox production'])
  })

  it('substitutes env names that contain digits', async () => {
    vi.stubEnv('EXTENSION_PUBLIC_API_V2', 'https://api.example/v2')
    const root = project(
      {
        'index.html': '<script>window.API="$EXTENSION_PUBLIC_API_V2"</script>',
        'manifest.json': '{"homepage_url":"$EXTENSION_PUBLIC_API_V2"}'
      },
      'console.log(process.env.EXTENSION_PUBLIC_API_V2)\n'
    )
    const result = await build(root, {copy: ['index.html', 'manifest.json']})

    expect(result.asset('index.html')).toBe(
      '<script>window.API="https://api.example/v2"</script>'
    )

    expect(result.asset('manifest.json')).toBe(
      '{"homepage_url":"https://api.example/v2"}'
    )

    expect(result.logs()).toEqual(['https://api.example/v2'])
  })
})

describe('EnvPlugin private names in emitted .json and .html', () => {
  it('leaves a private shell or .env name as written and warns once, without the value', async () => {
    vi.stubEnv('EXTENSION_SECRET_X', 'shell-secret')
    vi.stubEnv('EXTENSION_PUBLIC_FOO', 'shipped')
    const root = project(
      {
        '.env': 'EXTENSION_SECRET_TOKEN=file-secret\n',
        'manifest.json':
          '{"name":"$EXTENSION_PUBLIC_FOO","description":"$EXTENSION_SECRET_X","key":"$EXTENSION_SECRET_TOKEN","mode":"$EXTENSION_MODE"}',
        'index.html':
          '<title>$EXTENSION_PUBLIC_FOO</title><p>$EXTENSION_SECRET_X $EXTENSION_SECRET_X $EXTENSION_BROWSER</p>',
        'public/config.json': '{"token":"$EXTENSION_SECRET_TOKEN"}'
      },
      'console.log(process.env.EXTENSION_SECRET_X, import.meta.env.EXTENSION_SECRET_TOKEN)\n'
    )
    const result = await build(root, {
      mode: 'production',
      copy: ['manifest.json', 'index.html', 'public/config.json']
    })

    expect(result.asset('manifest.json')).toBe(
      '{"name":"shipped","description":"$EXTENSION_SECRET_X","key":"$EXTENSION_SECRET_TOKEN","mode":"production"}'
    )

    expect(result.asset('index.html')).toBe(
      '<title>shipped</title><p>$EXTENSION_SECRET_X $EXTENSION_SECRET_X chrome</p>'
    )

    expect(result.asset('public/config.json')).toBe(
      '{"token":"$EXTENSION_SECRET_TOKEN"}'
    )

    expect(getCurrentManifestContent(result.stats.compilation)).toBe(
      result.asset('manifest.json')
    )

    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([
      {
        name: 'EnvPrivatePlaceholder',
        message:
          '$EXTENSION_SECRET_TOKEN in manifest.json, public/config.json was left as written.\n' +
          '$EXTENSION_SECRET_X in index.html, manifest.json was left as written.\n' +
          'Placeholders in emitted .json and .html files are filled only from EXTENSION_PUBLIC_* variables, because those files ship to every user.\n' +
          'If the value is meant to ship, rename the variable with that prefix, such as EXTENSION_PUBLIC_SECRET_TOKEN.'
      }
    ])

    expect(result.logs()).toEqual(['undefined undefined'])
    expect(result.asset('background.js')).not.toContain('secret')
  })

  it('stays quiet about a private name no emitted file asks for', async () => {
    vi.stubEnv('EXTENSION_SECRET_X', 'shell-secret')
    const root = project({
      '.env': 'EXTENSION_SECRET_TOKEN=file-secret\n',
      'manifest.json': '{"name":"$EXTENSION_UNSET"}',
      'notes.txt': '$EXTENSION_SECRET_X'
    })
    const result = await build(root, {copy: ['manifest.json', 'notes.txt']})

    expect(result.asset('manifest.json')).toBe('{"name":"$EXTENSION_UNSET"}')
    expect(result.asset('notes.txt')).toBe('$EXTENSION_SECRET_X')
    expect(result.warnings).toEqual([])
  })

  it('names a secret-looking public name a production build fills into JSON', async () => {
    const root = project({
      '.env': 'EXTENSION_PUBLIC_API_KEY=shipped-key\n',
      'manifest.json': '{"key":"$EXTENSION_PUBLIC_API_KEY"}'
    })
    const result = await build(root, {
      mode: 'production',
      copy: ['manifest.json']
    })

    expect(result.asset('manifest.json')).toBe('{"key":"shipped-key"}')
    expect(result.warnings.map((warning) => warning.name)).toEqual([
      'EnvPublicSecretName'
    ])

    expect(result.warnings[0].message).toContain('EXTENSION_PUBLIC_API_KEY')
    expect(result.warnings[0].message).not.toContain('shipped-key')
  })
})

describe('EnvPlugin failure paths as they stand', () => {
  it('throws a coded error naming the folder while the compiler is created', () => {
    for (const name of ['.env', '.env.defaults']) {
      const root = project({})
      fs.mkdirSync(path.join(root, name))
      let thrown: unknown

      try {
        createCompiler({
          context: root,
          outputPath: path.join(root, 'out'),
          entry: {background: './background.js'},
          plugins: [new EnvPlugin({browser: 'chrome'})]
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({
        code: 'E_ENV_FILE_UNREADABLE',
        message: expect.stringContaining(`${name} is a folder`)
      })

      expect(fs.existsSync(path.join(root, 'out'))).toBe(false)
    }
  })

  // Pins current behavior: the failed folder read is swallowed.
  it('says nothing about stray env files when the project folder cannot be listed', () => {
    const root = project({'.env.staging': 'EXTENSION_PUBLIC_FOO=staging\n'})

    const warningTaps = (context: string) => {
      const compiler = createCompiler({
        context: root,
        outputPath: path.join(root, 'out')
      })
      // rspack itself refuses a file as context, so only EnvPlugin sees it.
      compiler.options.context = context
      new EnvPlugin({browser: 'chrome'}).apply(compiler)

      return compiler.hooks.thisCompilation.taps
        .map((tap) => tap.name)
        .filter((name) => name.startsWith('env:warn'))
    }

    // readdir on a file fails like an unreadable folder, and the catch is silent.
    expect(warningTaps(path.join(root, 'manifest.json'))).toEqual([])
    expect(warningTaps(root)).toEqual(['env:warn-unmatched'])
  })
})

describe('import.meta.url for runtime-loaded files', () => {
  it('gives a runtime-loaded file its emit path as import.meta.url', () => {
    const define = importMetaUrlForEmitPath('lib\\engine.js')
    expect(define).toContain('getURL("lib/engine.js")')
    expect(define).not.toContain('file:')
    // Without an extension runtime the page-or-root guess still stands in.
    expect(define).toContain(IMPORT_META_URL_RUNTIME)
  })

  it('escapes every character that could break out of the emitted literal', () => {
    const hostile = 'lib/a"b\\c</script>\u2028d\u2029e\u00e9f'
    const literal = toJsStringLiteral(hostile)

    expect(literal).toMatch(/^"[\x20-\x7e]*"$/)
    expect(literal).not.toContain('</script>')
    expect(literal).not.toContain('\u2028')
    expect(new Function(`return ${literal}`)()).toBe(hostile)

    const define = importMetaUrlForEmitPath(hostile)
    expect(define).toContain(
      `getURL(${toJsStringLiteral(hostile.replace(/\\/g, '/'))})`
    )

    expect(define).not.toContain('</script>')
  })
})
