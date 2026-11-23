import fs from 'node:fs'
import path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import type {DevOptions, FilepathList} from '../../../types'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'
import {AddScripts} from '../steps/add-scripts'
import {CompileMainWorldScripts} from '../steps/compile-main-world-scripts'

// One file per manifest field in a real watch session: the file is deleted
// after the first build, then written back with new text.
const tempFolder = trackTempFolders()
const watching: Compiler[] = []

afterEach(async () => {
  for (const compiler of watching.splice(0).reverse()) {
    await new Promise<void>((resolve) => compiler.close(() => resolve()))
  }
})

interface Report {
  name: string
  message: string
  file?: string
}

interface Built {
  errors: Report[]
  warnings: Report[]
  // The layer of each module built from the file, in the isolated graph
  // and in the graph a MAIN world group compiles apart.
  isolated: Array<string | null>
  main: Array<string | null>
}

interface Row {
  title: string
  manifest: Record<string, unknown>
  includeList: (at: (...parts: string[]) => string) => FilepathList
  browser: DevOptions['browser']
  // The file that is deleted, as the manifest names it.
  named: string
  field: string
  output: string
  // The layer the entry puts the file in, which a rule may match on.
  layer?: string
  world?: 'MAIN'
  // A bundle the isolated graph builds beside a MAIN world one.
  beside?: string
  text: (marker: string) => string
}

const script = (marker: string) => `console.log(${JSON.stringify(marker)})\n`
const sheet = (marker: string) => `body::after { content: "${marker}"; }\n`

const ROWS: Row[] = [
  {
    title: 'a single content script',
    manifest: {
      manifest_version: 3,
      content_scripts: [{matches: ['<all_urls>'], js: ['src/named.js']}]
    },
    includeList: (at) => ({
      'content_scripts/content-0': [at('src', 'named.js')]
    }),
    browser: 'chrome',
    named: 'src/named.js',
    field: 'content_scripts[0].js',
    output: 'content_scripts/content-0.js',
    layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
    text: script
  },
  {
    title: 'a background service worker',
    manifest: {
      manifest_version: 3,
      background: {service_worker: 'src/named.js'}
    },
    includeList: (at) => ({
      'background/service_worker': at('src', 'named.js')
    }),
    browser: 'chrome',
    named: 'src/named.js',
    field: 'background.service_worker',
    output: 'background/service_worker.js',
    text: script
  },
  {
    title: 'a single background script on Firefox',
    manifest: {
      manifest_version: 2,
      background: {scripts: ['src/named.js']}
    },
    includeList: (at) => ({'background/scripts': [at('src', 'named.js')]}),
    browser: 'firefox',
    named: 'src/named.js',
    field: 'background.scripts',
    output: 'background/scripts.js',
    text: script
  },
  {
    title: 'a content script stylesheet',
    manifest: {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['src/kept.js'], css: ['src/named.css']}
      ]
    },
    includeList: (at) => ({
      'content_scripts/content-0': [
        at('src', 'kept.js'),
        at('src', 'named.css')
      ]
    }),
    browser: 'chrome',
    named: 'src/named.css',
    field: 'content_scripts[0].css',
    output: 'content_scripts/content-0.css',
    layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
    text: sheet
  },
  // Chrome 111 and Firefox 128 both run a MAIN world group.
  ...(['chrome', 'firefox'] as const).map((browser) => ({
    title: `a MAIN world content script on ${browser}`,
    manifest: {
      manifest_version: 3,
      background: {service_worker: 'src/kept.js', scripts: ['src/kept.js']},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['src/named.js'], world: 'MAIN'}
      ]
    },
    includeList: (at: (...parts: string[]) => string) => ({
      [browser === 'chrome'
        ? 'background/service_worker'
        : 'background/scripts']:
        browser === 'chrome' ? at('src', 'kept.js') : [at('src', 'kept.js')],
      'content_scripts/content-0': [at('src', 'named.js')]
    }),
    browser,
    named: 'src/named.js',
    field: 'content_scripts[0].js',
    output: 'content_scripts/content-0.js',
    layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
    world: 'MAIN' as const,
    beside:
      browser === 'chrome'
        ? 'background/service_worker.js'
        : 'background/scripts.js',
    text: script
  }))
]

// The dev server adds the hot runtime, which a MAIN world bundle is kept
// clear of, since it would run on the page itself.
const HOT_RUNTIME = '__webpack_require__.hmrC'

// With `imported`, the named file imports that one, which is the file
// deleted and written back.
function session(row: Row, imported?: string) {
  const root = fs.realpathSync(tempFolder('extjs-entry-written-back-'))

  const at = (...parts: string[]) => path.join(root, ...parts)
  const named = at(...row.named.split('/'))
  const file = imported ? at(...imported.split('/')) : named

  fs.mkdirSync(at('src'))
  fs.writeFileSync(at('package.json'), '{"name":"fixture"}\n')
  fs.writeFileSync(at('src', 'kept.js'), script('kept'))
  fs.writeFileSync(file, row.text('written first'))

  // Both sit in one folder.
  if (imported) {
    const request = `./${path.basename(file)}`

    fs.writeFileSync(named, `import ${JSON.stringify(request)}\n`)
  }

  fs.writeFileSync(
    at('manifest.json'),
    JSON.stringify({name: 'written-back', version: '1.0.0', ...row.manifest})
  )

  const compiler = rspack({
    context: root,
    mode: 'development',
    devtool: false,
    entry: {},
    output: {path: at('dist'), filename: '[name].js'},
    module: {rules: [{test: /\.css$/, type: 'css'}]},
    plugins: [
      new AddScripts({
        manifestPath: at('manifest.json'),
        includeList: row.includeList(at),
        browser: row.browser
      }),
      ...(row.world === 'MAIN'
        ? [
            new CompileMainWorldScripts({
              manifestPath: at('manifest.json'),
              includeList: row.includeList(at),
              browser: row.browser
            }),
            new rspack.HotModuleReplacementPlugin()
          ]
        : [])
    ]
  })
  watching.push(compiler)

  const builds: Built[] = []
  const waiting: Array<() => void> = []

  compiler.hooks.done.tap('spec', (stats) => {
    const pick = (list: Report[] = []) =>
      list.map(({name, message, file}) => ({name, message, file}))

    const layersOf = (modules: Iterable<unknown>) =>
      Array.from(modules)
        .map((module) => module as {resource?: string; layer?: string | null})
        .filter(({resource}) => resource === file)
        .map(({layer}) => layer ?? null)

    builds.push({
      errors: pick(stats.compilation.errors as Report[]),
      warnings: pick(stats.compilation.warnings as Report[]),
      isolated: layersOf(stats.compilation.modules),
      main: stats.compilation.children
        .filter(({name}) => name?.startsWith(CompileMainWorldScripts.name))
        .flatMap((child) => layersOf(child.modules))
    })

    for (const resolve of waiting.splice(0)) resolve()
  })

  // Polled, so a loaded machine sees an edit as soon as an idle one.
  compiler.watch({aggregateTimeout: 50, poll: 100}, () => {})

  // The build after the ones already seen, or a failure when none comes.
  const next = async (seen: number) => {
    const deadline = Date.now() + 60000

    while (builds.length <= seen) {
      if (Date.now() > deadline) throw new Error('no build followed the edit')

      await Promise.race([
        new Promise<void>((resolve) => waiting.push(resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, 500))
      ])
    }

    // Several edits may land in builds of their own, and the session
    // watches again a moment after a build ends. The last quiet one counts.
    for (let count = -1; count !== builds.length; ) {
      count = builds.length
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
    }

    return builds[builds.length - 1]
  }

  const emitted = (output = row.output) =>
    fs.readFileSync(at('dist', ...output.split('/')), 'utf8')

  return {file, builds, next, emitted, compiler}
}

// Exactly one module of the file, in the graph its world builds it in.
const builtIn = (row: Row) =>
  row.world === 'MAIN'
    ? {isolated: [], main: [row.layer ?? null]}
    : {isolated: [row.layer ?? null], main: []}
const clean = {errors: [], warnings: []}

describe.each(ROWS)('$title, deleted in a watch session', (row) => {
  it('fails once with the file and the manifest field', async () => {
    const {file, builds, next, emitted} = session(row)

    expect(await next(0)).toMatchObject({...clean, ...builtIn(row)})
    expect(emitted()).toContain('written first')

    if (row.beside) {
      expect(emitted(row.beside)).toContain(HOT_RUNTIME)
      expect(emitted()).not.toContain(HOT_RUNTIME)
    }

    fs.rmSync(file)

    const rebuilt = await next(builds.length)

    expect(rebuilt).toMatchObject({isolated: [], main: []})

    const reports = rebuilt.errors.filter(
      ({name}) => name === 'ScriptsMissingFile'
    )

    expect(rebuilt.warnings).toEqual([])
    expect(reports).toHaveLength(1)
    expect(reports[0].message).toContain(`${row.named} does not exist`)
    expect(reports[0].message).toContain(`Check the ${row.field} field`)
    expect(reports[0].file).toBe('manifest.json')
    expect(rebuilt.errors).toHaveLength(1)
  }, 120000)

  // The entry check has passed by the time the modules are made, so the
  // delete lands between it and every later look at the file.
  it('fails once with the file and the field when deleted while a build runs', async () => {
    const {file, builds, next, compiler} = session(row)

    await next(0)

    let armed = true

    compiler.hooks.make.tap('spec:delete-mid-build', () => {
      if (!armed) return

      armed = false
      fs.rmSync(file)
    })

    compiler.watching?.invalidate()

    // The last quiet build: the one in flight, or the one a watcher adds.
    const rebuilt = await next(builds.length)
    const reports = rebuilt.errors.filter(
      ({name}) => name === 'ScriptsMissingFile'
    )

    expect(reports).toHaveLength(1)
    expect(reports[0].message).toContain(`${row.named} does not exist`)
    expect(reports[0].message).toContain(`Check the ${row.field} field`)
    expect(reports[0].file).toBe('manifest.json')
    expect(rebuilt.errors).toHaveLength(1)
    expect(rebuilt.warnings).toEqual([])
    expect(rebuilt).toMatchObject({isolated: [], main: []})
  }, 120000)

  it('builds the new text once the file is written back', async () => {
    const {file, builds, next, emitted} = session(row)

    await next(0)
    fs.rmSync(file)
    await next(builds.length)
    fs.writeFileSync(file, row.text('written back'))

    expect(await next(builds.length)).toMatchObject({...clean, ...builtIn(row)})
    expect(emitted()).toContain('written back')
    expect(emitted()).not.toContain('written first')

    if (row.world === 'MAIN') expect(emitted()).not.toContain(HOT_RUNTIME)

    fs.writeFileSync(file, row.text('edited after'))

    expect(await next(builds.length)).toMatchObject({...clean, ...builtIn(row)})
    expect(emitted()).toContain('edited after')
  }, 120000)

  it('does the same when the file is deleted a second time', async () => {
    const {file, builds, next, emitted} = session(row)

    await next(0)
    fs.rmSync(file)
    await next(builds.length)
    fs.writeFileSync(file, row.text('written back'))
    await next(builds.length)
    fs.rmSync(file)

    const rebuilt = await next(builds.length)

    expect(rebuilt.warnings).toEqual([])
    expect(rebuilt.errors.map(({name}) => name)).toEqual(['ScriptsMissingFile'])
    expect(rebuilt.errors[0].message).toContain(`${row.named} does not exist`)

    fs.writeFileSync(file, row.text('written a third time'))

    expect(await next(builds.length)).toMatchObject({...clean, ...builtIn(row)})
    expect(emitted()).toContain('written a third time')

    if (row.world === 'MAIN') expect(emitted()).not.toContain(HOT_RUNTIME)
  }, 120000)
})

describe.each(
  ROWS.filter(({world}) => world === 'MAIN')
)('a file $title imports, deleted in a watch session', (row) => {
  it('builds the new text once the file is written back', async () => {
    const {file, builds, next, emitted} = session(row, 'src/imported.js')

    expect(await next(0)).toMatchObject({...clean, ...builtIn(row)})
    fs.rmSync(file)

    const rebuilt = await next(builds.length)

    expect(rebuilt.warnings).toEqual([])
    expect(rebuilt.errors).toHaveLength(1)
    expect(rebuilt.errors[0].message).toContain("Can't resolve './imported.js'")
    expect(rebuilt.errors[0].file).toBe('./src/named.js')

    fs.writeFileSync(file, row.text('written back'))

    expect(await next(builds.length)).toMatchObject({...clean, ...builtIn(row)})
    expect(emitted()).toContain('written back')
    expect(emitted()).not.toContain(HOT_RUNTIME)
  }, 120000)
})
