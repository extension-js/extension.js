import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  getPreloadedEnvKeys,
  loadProjectConfigDefaults
} from '../../lib/config-loader'
import {EnvPlugin} from '../env'
import {
  compile,
  makeTempRoot,
  removeTempRoots,
  runScript,
  writeFiles
} from './helpers/real-compile'

type Mode = 'development' | 'production'

const MODES: Mode[] = ['development', 'production']

// Written out on purpose: the plugin and the config loader share one list, so
// only a list kept here can tell when that list changes.
const weakestFirst = (mode: Mode) => [
  '.env.defaults',
  '.env',
  '.env.local',
  `.env.${mode}`,
  `.env.${mode}.local`,
  '.env.chromium-based',
  `.env.chromium-based.${mode}`,
  '.env.edge',
  `.env.edge.${mode}`,
  '.env.chromium',
  `.env.chromium.${mode}`,
  '.env.chrome',
  `.env.chrome.${mode}`
]

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')

interface BuildOptions {
  mode: Mode
  context?: string
  entries: string[]
  copy?: string[]
}

async function build(root: string, options: BuildOptions) {
  const context = options.context || root
  const outputPath = path.join(root, 'out')
  const stats = await compile({
    context,
    outputPath,
    mode: options.mode,
    outputClean: true,
    entry: Object.fromEntries(
      options.entries.map((name) => [name, `./${name}.js`])
    ),
    copy: options.copy,
    plugins: [
      new EnvPlugin({
        manifestPath: path.join(context, 'manifest.json'),
        browser: 'chrome'
      })
    ],
    // Source maps are emitted files too, and they quote the sources.
    configure: (config) => {
      config.devtool = 'source-map'
    }
  })

  return {
    outputPath,
    warnings: Array.from(stats.compilation.warnings, (warning) => ({
      name: warning.name,
      message: stripAnsi(warning.message)
    })),
    errors: Array.from(stats.compilation.errors, (error) => error.message),
    read: (name: string) =>
      fs.readFileSync(path.join(outputPath, name), 'utf8'),
    logs: (name: string) => runScript(path.join(outputPath, `${name}.js`))
  }
}

function emittedFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

// A value can ship as written or inside base64, where its bytes land on any
// of three alignments. Only the characters every alignment fixes are kept.
function shippedForms(marker: string): string[] {
  const forms = [marker]

  for (const lead of [0, 1, 2]) {
    const encoded = Buffer.from('\0'.repeat(lead) + marker).toString('base64')
    const tail = (lead + marker.length) % 3

    forms.push(
      encoded
        .replace(/=+$/, '')
        .slice(lead === 0 ? 0 : lead + 1, tail === 0 ? undefined : -1)
    )
  }

  return forms
}

function filesCarrying(dir: string, marker: string): string[] {
  const forms = shippedForms(marker)

  return emittedFiles(dir)
    .filter((file) => {
      const bytes = fs.readFileSync(file)

      return forms.some((form) => bytes.includes(form))
    })
    .map((file) => path.relative(dir, file))
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

const SHARED_ENTRY =
  'console.log(process.env.EXTENSION_PUBLIC_SHARED, process.env.EXTENSION_PUBLIC_ONLY)\n'
const WHOLE_ENTRY =
  'console.log(JSON.stringify(process.env))\nconsole.log(JSON.stringify(import.meta.env))\n'

describe('EnvPlugin env file layers, pair by pair', () => {
  it.each(
    MODES
  )('lets the stronger file win a shared key and keeps the weaker file own key in %s', async (mode) => {
    const order = weakestFirst(mode)
    const root = makeTempRoot('env-pairs')
    writeFiles(root, {
      'manifest.json':
        '{"shared":"$EXTENSION_PUBLIC_SHARED","only":"$EXTENSION_PUBLIC_ONLY"}',
      'read.js': SHARED_ENTRY,
      'whole.js': WHOLE_ENTRY
    })

    const seen: string[] = []
    const expected: string[] = []

    for (let weak = 0; weak < order.length; weak++) {
      for (let strong = weak + 1; strong < order.length; strong++) {
        const files = {
          [order[weak]]:
            `EXTENSION_PUBLIC_SHARED=${order[weak]}\nEXTENSION_PUBLIC_ONLY=${order[weak]}\n`,
          [order[strong]]: `EXTENSION_PUBLIC_SHARED=${order[strong]}\n`
        }
        writeFiles(root, files)
        const result = await build(root, {
          mode,
          entries: ['read', 'whole'],
          copy: ['manifest.json']
        })
        const fromProcess = JSON.parse(result.logs('whole')[0])
        const fromJson = JSON.parse(result.read('manifest.json'))

        for (const file of Object.keys(files)) {
          fs.rmSync(path.join(root, file))
        }

        const pair = `${order[weak]} under ${order[strong]}:`
        const winners = `${order[strong]} ${order[weak]}`
        expected.push(`${pair} ${winners} | ${winners} | ${winners}`)
        seen.push(
          `${pair} ${result.logs('read')[0]} | ${fromJson.shared} ${fromJson.only} | ${fromProcess.EXTENSION_PUBLIC_SHARED} ${fromProcess.EXTENSION_PUBLIC_ONLY}`
        )
      }
    }

    expect(seen).toEqual(expected)
    expect(seen).toHaveLength(78)
  }, 120_000)
})

const MARKER = 'zq7privatemarker'

function privacyProject(mode: Mode) {
  const order = weakestFirst(mode)
  const root = makeTempRoot('env-private')
  const secretNames = [
    ...order.map((_, index) => `EXTENSION_SECRET_${index}`),
    'EXTENSION_SECRET_SHELL'
  ]
  const publicNames = order.map((_, index) => `EXTENSION_PUBLIC_K${index}`)
  const placeholders = [...secretNames, ...publicNames]

  writeFiles(root, {
    ...Object.fromEntries(
      order.map((file, index) => [
        file,
        `EXTENSION_PUBLIC_K${index}=public-${index}\n` +
          `EXTENSION_SECRET_${index}=${MARKER}-extension-${index}\n` +
          `PLAIN_SECRET_${index}=${MARKER}-plain-${index}\n`
      ])
    ),
    'manifest.json': JSON.stringify(
      Object.fromEntries(placeholders.map((name) => [name, `$${name}`]))
    ),
    'index.html':
      `<html><body data-all="${placeholders.map((name) => `$${name}`).join(' ')}">` +
      `<p>${placeholders.map((name) => `$${name}`).join(' ')}</p>` +
      `<script>const all = "${placeholders.map((name) => `$${name}`).join(' ')}"</script>` +
      `</body></html>`,
    'public/config.json': JSON.stringify({
      values: placeholders.map((name) => `$${name}`)
    }),
    'notes.txt': placeholders.map((name) => `$${name}`).join('\n'),
    'read.js':
      `const name = 'EXTENSION_SECRET_' + 1\n` +
      `const {EXTENSION_SECRET_2, PLAIN_SECRET_2} = process.env\n` +
      `console.log(process.env.EXTENSION_SECRET_0, process.env[name], EXTENSION_SECRET_2, PLAIN_SECRET_2, import.meta.env.EXTENSION_SECRET_3, import.meta.env.PLAIN_SECRET_3, process.env.EXTENSION_SECRET_SHELL, process.env.PLAIN_SECRET_SHELL)\n`,
    'whole.js': WHOLE_ENTRY
  })

  return {root, order, secretNames, publicNames}
}

describe.each(MODES)('EnvPlugin private values in a %s build', (mode) => {
  async function builtProject() {
    vi.stubEnv('EXTENSION_SECRET_SHELL', `${MARKER}-extension-shell`)
    vi.stubEnv('PLAIN_SECRET_SHELL', `${MARKER}-plain-shell`)
    const project = privacyProject(mode)
    const result = await build(project.root, {
      mode,
      entries: ['read', 'whole'],
      copy: ['manifest.json', 'index.html', 'public/config.json', 'notes.txt']
    })

    return {...project, result}
  }

  it('writes no private value from any env file or the shell into any emitted file', async () => {
    const {result, publicNames} = await builtProject()

    expect(result.errors).toEqual([])
    // The search has to find a value that did ship, written or encoded. A
    // public one is in every file but the text file no placeholder fills.
    expect(filesCarrying(result.outputPath, 'public-4')).toEqual([
      'index.html',
      'manifest.json',
      path.join('public', 'config.json'),
      'read.js',
      'read.js.map',
      'whole.js',
      'whole.js.map'
    ])

    expect(shippedForms('public-4')).toContain(
      Buffer.from('"K4":"public-4",').toString('base64').slice(8, 18)
    )

    expect(emittedFiles(result.outputPath)).toHaveLength(8)
    expect(filesCarrying(result.outputPath, MARKER)).toEqual([])
    expect(JSON.stringify(result.warnings)).not.toContain(MARKER)
    expect(result.logs('read')).toEqual([
      Array.from({length: 8}, () => 'undefined').join(' ')
    ])

    const manifest = JSON.parse(result.read('manifest.json'))

    expect(publicNames.map((name) => manifest[name])).toEqual(
      publicNames.map((_, index) => `public-${index}`)
    )
  })

  it('leaves every private placeholder as written and says so once', async () => {
    const {result, secretNames} = await builtProject()
    const manifest = JSON.parse(result.read('manifest.json'))

    expect(secretNames.map((name) => manifest[name])).toEqual(
      secretNames.map((name) => `$${name}`)
    )

    for (const file of ['index.html', 'public/config.json', 'notes.txt']) {
      for (const name of secretNames) {
        expect(result.read(file)).toContain(`$${name}`)
      }
    }

    expect(result.warnings.map((warning) => warning.name)).toEqual([
      'EnvPrivatePlaceholder'
    ])

    for (const name of secretNames) {
      expect(result.warnings[0].message).toContain(`$${name} in `)
    }
  })

  it('gives the process module the public value of every layer and nothing private', async () => {
    const {result, publicNames} = await builtProject()
    const target = {
      EXTENSION_PUBLIC_BROWSER: 'chrome',
      EXTENSION_PUBLIC_MODE: mode,
      EXTENSION_BROWSER: 'chrome',
      EXTENSION_MODE: mode,
      BROWSER: 'chrome',
      MODE: mode
    }
    const [fromProcess, fromImportMeta] = result
      .logs('whole')
      .map((line) => JSON.parse(line))

    expect(fromProcess).toEqual({
      ...Object.fromEntries(
        publicNames.map((name, index) => [name, `public-${index}`])
      ),
      ...target
    })

    expect(fromImportMeta).toEqual(fromProcess)
  })
})

describe('EnvPlugin reserved names across layers', () => {
  it('warns once and names the strongest file that set each name', async () => {
    const root = makeTempRoot('env-reserved')
    writeFiles(root, {
      '.env': 'EXTENSION_PUBLIC_MODE=other-one\nEXTENSION_BROWSER=netscape\n',
      '.env.production': 'EXTENSION_PUBLIC_MODE=other-two\n',
      '.env.production.local': 'EXTENSION_PUBLIC_MODE=other-three\n',
      'manifest.json': '{"mode":"$EXTENSION_PUBLIC_MODE"}',
      'read.js':
        'console.log(process.env.EXTENSION_PUBLIC_MODE, process.env.EXTENSION_BROWSER)\n'
    })

    const result = await build(root, {
      mode: 'production',
      entries: ['read'],
      copy: ['manifest.json']
    })

    expect(result.logs('read')).toEqual(['production chrome'])
    expect(result.read('manifest.json')).toBe('{"mode":"production"}')
    expect(result.warnings.map((warning) => warning.name)).toEqual([
      'EnvReservedName'
    ])

    expect(result.warnings[0].message).toContain(
      'EXTENSION_BROWSER in .env is reserved'
    )

    expect(result.warnings[0].message).toContain(
      'EXTENSION_PUBLIC_MODE in .env.production.local is reserved'
    )

    expect(result.warnings[0].message).not.toMatch(/other-|netscape/)
  })
})

// File N sets keys N and up, so key N reads the name of the file that won it.
function layeredFiles(order: string[]) {
  const keys = order.map((_, index) => `EXTENSION_PUBLIC_K${index}`)

  return {
    keys,
    files: Object.fromEntries(
      order.map((file, index) => [
        file,
        keys
          .slice(index)
          .map((key) => `${key}=${file}\n`)
          .join('')
      ])
    )
  }
}

const configSource = (keys: string[]) =>
  `require('node:fs').writeFileSync(
  require('node:path').join(__dirname, 'seen.json'),
  JSON.stringify(${JSON.stringify(keys)}.map((key) => String(process.env[key])))
)
module.exports = {}
`

describe('the config file and the bundle read one environment', () => {
  // The config loader leaves what it read on process.env for the whole run.
  afterEach(() => {
    const preloaded = getPreloadedEnvKeys() as Set<string>

    for (const key of preloaded) delete process.env[key]
    preloaded.clear()
  })

  async function seenByBoth(root: string, context: string, keys: string[]) {
    writeFiles(context, {
      'package.json': '{"private":true,"name":"env-layers","version":"0.0.0"}',
      'manifest.json': '{"manifest_version":3,"name":"x","version":"1.0.0"}',
      'extension.config.js': configSource(keys),
      'read.js': `console.log(JSON.stringify([${keys.map((key) => `String(process.env.${key})`).join(', ')}]))\n`
    })

    await loadProjectConfigDefaults(context, {
      mode: 'production',
      browser: 'chrome'
    })

    const result = await build(root, {
      mode: 'production',
      context,
      entries: ['read']
    })

    return {
      config: JSON.parse(
        fs.readFileSync(path.join(context, 'seen.json'), 'utf8')
      ),
      bundle: JSON.parse(result.logs('read')[0])
    }
  }

  it('gives both the same winner for every layer of the project folder', async () => {
    const order = weakestFirst('production')
    const {keys, files} = layeredFiles(order)
    const root = makeTempRoot('env-config-bundle')
    writeFiles(root, {
      ...files,
      '.env.development': keys.map((key) => `${key}=other-mode\n`).join(''),
      '.env.firefox': keys.map((key) => `${key}=other-browser\n`).join('')
    })

    const seen = await seenByBoth(root, root, keys)

    expect(seen.config).toEqual(order)
    expect(seen.bundle).toEqual(order)
  })

  it('sends both to the workspace root when the package has no env file', async () => {
    const order = weakestFirst('production')
    const {keys, files} = layeredFiles(order)
    const root = makeTempRoot('env-config-bundle-workspace')
    writeFiles(root, {
      ...files,
      'pnpm-workspace.yaml': "packages: ['packages/*']\n"
    })

    const seen = await seenByBoth(
      root,
      path.join(root, 'packages', 'ext'),
      keys
    )

    expect(seen.config).toEqual(order)
    expect(seen.bundle).toEqual(order)
  })

  it('keeps both in the package once it has one file of its own', async () => {
    const order = weakestFirst('production')
    const {keys, files} = layeredFiles(order)
    const root = makeTempRoot('env-config-bundle-local')
    const context = path.join(root, 'packages', 'ext')
    writeFiles(root, {
      ...files,
      'pnpm-workspace.yaml': "packages: ['packages/*']\n",
      'packages/ext/.env.production.local': `${keys[0]}=package\n`
    })

    const seen = await seenByBoth(root, context, keys)
    const expected = ['package', ...keys.slice(1).map(() => 'undefined')]

    expect(seen.config).toEqual(expected)
    expect(seen.bundle).toEqual(expected)
  })
})
