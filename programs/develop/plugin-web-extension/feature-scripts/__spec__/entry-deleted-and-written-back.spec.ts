import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import type {DevOptions, FilepathList} from '../../../types'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'
import {AddScripts} from '../steps/add-scripts'

// One file per manifest field in a real watch session: the file is deleted
// after the first build, then written back with new text.
const roots: string[] = []
const watching: Compiler[] = []

afterEach(async () => {
  while (watching.length > 0) {
    const compiler = watching.pop()!
    await new Promise<void>((resolve) => compiler.close(() => resolve()))
  }
})

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

interface Report {
  name: string
  message: string
  file?: string
}

interface Built {
  errors: Report[]
  warnings: Report[]
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
  }
]

function session(row: Row) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-entry-written-back-'))
  )
  roots.push(root)

  const at = (...parts: string[]) => path.join(root, ...parts)
  const file = at(...row.named.split('/'))

  fs.mkdirSync(at('src'))
  fs.writeFileSync(at('package.json'), '{"name":"fixture"}\n')
  fs.writeFileSync(at('src', 'kept.js'), script('kept'))
  fs.writeFileSync(file, row.text('written first'))
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
      })
    ]
  })
  watching.push(compiler)

  const builds: Built[] = []
  const layers: Array<string | undefined> = []
  const waiting: Array<() => void> = []

  compiler.hooks.done.tap('spec', (stats) => {
    const pick = (list: Report[] = []) =>
      list.map(({name, message, file}) => ({name, message, file}))

    builds.push({
      errors: pick(stats.compilation.errors as Report[]),
      warnings: pick(stats.compilation.warnings as Report[])
    })

    for (const module of stats.compilation.modules) {
      const {resource, layer} = module as {resource?: string; layer?: string}

      if (resource === file) layers.push(layer ?? undefined)
    }

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

  const emitted = () =>
    fs.readFileSync(at('dist', ...row.output.split('/')), 'utf8')

  return {file, builds, layers, next, emitted}
}

describe.each(ROWS)('$title, deleted in a watch session', (row) => {
  it('fails once with the file and the manifest field', async () => {
    const {file, builds, next, emitted} = session(row)

    expect(await next(0)).toEqual({errors: [], warnings: []})
    expect(emitted()).toContain('written first')

    fs.rmSync(file)

    const rebuilt = await next(builds.length)
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

  it('builds the new text once the file is written back', async () => {
    const {file, builds, layers, next, emitted} = session(row)

    await next(0)
    fs.rmSync(file)
    await next(builds.length)
    fs.writeFileSync(file, row.text('written back'))

    expect(await next(builds.length)).toEqual({errors: [], warnings: []})
    expect(emitted()).toContain('written back')
    expect(emitted()).not.toContain('written first')
    expect(layers.length).toBeGreaterThan(1)
    expect([...new Set(layers)]).toEqual([row.layer])

    fs.writeFileSync(file, row.text('edited after'))

    expect(await next(builds.length)).toEqual({errors: [], warnings: []})
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

    expect(await next(builds.length)).toEqual({errors: [], warnings: []})
    expect(emitted()).toContain('written a third time')
  }, 120000)
})
