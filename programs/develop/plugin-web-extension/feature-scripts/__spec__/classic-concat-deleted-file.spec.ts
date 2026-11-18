import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import {AddAssetsToCompilation} from '../../feature-html/steps/add-assets-to-compilation'
import {classicConcatEntry} from '../../shared/classic-concat'
import classicConcatLoader from '../steps/add-content-script-wrapper/classic-concat-loader'
import {AddScripts} from '../steps/add-scripts'

// Classic scripts joined in a real watch session, with one file deleted
// after the first build. The step that owns the reference reports it.
const roots: string[] = []
const watching: Compiler[] = []
const before = process.env.EXTENSION_STRICT_REFS
const HOLDER = '__EXTJS_SPEC_CLASSIC_CONCAT_LOADER__'

afterEach(async () => {
  if (before === undefined) delete process.env.EXTENSION_STRICT_REFS
  else process.env.EXTENSION_STRICT_REFS = before

  while (watching.length > 0) {
    const compiler = watching.pop()!
    await new Promise<void>((resolve) => compiler.close(() => resolve()))
  }
})

afterAll(() => {
  Reflect.deleteProperty(globalThis, HOLDER)

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

// The bundler loads a loader by path, so a stand-in on disk hands each call
// to the loader of this source tree.
const STAND_IN =
  `module.exports = function (...args) {\n` +
  `  return globalThis.${HOLDER}.apply(this, args)\n` +
  '}\n'

function session(feature: 'sidebar/index' | 'content_scripts/content-0') {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-concat-deleted-'))
  )
  roots.push(root)
  Reflect.set(globalThis, HOLDER, classicConcatLoader)

  const at = (...parts: string[]) => path.join(root, ...parts)
  const files = ['first.js', 'second.js', 'third.js'].map((name) =>
    at('sidebar', name)
  )

  fs.mkdirSync(at('sidebar'))
  fs.writeFileSync(at('package.json'), '{"name":"fixture"}\n')
  fs.writeFileSync(at('stand-in-loader.cjs'), STAND_IN)
  fs.writeFileSync(files[0], 'var seen = ["first"]\n')
  fs.writeFileSync(files[1], 'seen.push("second")\n')
  fs.writeFileSync(files[2], 'seen.push("third")\nglobalThis.seen = seen\n')
  fs.writeFileSync(
    at('sidebar', 'index.html'),
    '<html><body>' +
      '<script src="first.js"></script>' +
      '<script src="second.js"></script>' +
      '<script src="third.js"></script>' +
      '</body></html>\n'
  )

  fs.writeFileSync(
    at('manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'concat-deleted',
      version: '1.0.0',
      side_panel: {default_path: 'sidebar/index.html'},
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['sidebar/first.js', 'sidebar/second.js', 'sidebar/third.js']
        }
      ]
    })
  )

  const manifestPath = at('manifest.json')
  // A page is entered by the HTML step, a content script group by AddScripts.
  const ofPage = feature === 'sidebar/index'

  const compiler = rspack({
    context: root,
    mode: 'development',
    devtool: false,
    entry: ofPage ? {[feature]: classicConcatEntry(feature, files)} : {},
    output: {path: at('dist'), filename: '[name].js'},
    module: {
      rules: [
        {
          resourceQuery: /__extensionjs_classic_concat__/,
          use: [{loader: at('stand-in-loader.cjs')}]
        }
      ]
    },
    plugins: [
      ofPage
        ? new AddAssetsToCompilation({
            manifestPath,
            includeList: {[feature]: at('sidebar', 'index.html')}
          })
        : new AddScripts({manifestPath, includeList: {[feature]: files}})
    ]
  })
  watching.push(compiler)

  const builds: Built[] = []
  const waiting: Array<() => void> = []

  compiler.hooks.done.tap('spec', (stats) => {
    const pick = (list: Report[] = []) =>
      list.map(({name, message, file}) => ({name, message, file}))

    builds.push({
      errors: pick(stats.compilation.errors as Report[]),
      warnings: pick(stats.compilation.warnings as Report[])
    })

    for (const resolve of waiting.splice(0)) resolve()
  })

  compiler.watch({aggregateTimeout: 50}, () => {})

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

    return builds[builds.length - 1]
  }

  const ran = () => {
    const page: Record<string, unknown> = {}
    page.globalThis = page
    vm.runInNewContext(
      fs.readFileSync(at('dist', ...`${feature}.js`.split('/')), 'utf8'),
      page
    )

    return page.seen
  }

  return {files, builds, next, ran}
}

describe('a page whose classic scripts are joined, in a watch session', () => {
  it('builds the three files in order', async () => {
    const {next, ran} = session('sidebar/index')
    const first = await next(0)

    expect(first).toEqual({errors: [], warnings: []})
    expect(ran()).toEqual(['first', 'second', 'third'])
  }, 120000)

  it('leaves out a later file that was deleted, and warns with its name', async () => {
    const {files, builds, next, ran} = session('sidebar/index')

    await next(0)
    fs.rmSync(files[1])

    const rebuilt = await next(builds.length)

    expect(rebuilt.errors).toEqual([])
    expect(rebuilt.warnings).toHaveLength(1)
    expect(rebuilt.warnings[0].name).toBe('HtmlEntrypointMissing')
    expect(rebuilt.warnings[0].message).toContain('second.js')
    expect(rebuilt.warnings[0].message).not.toContain('ENOENT')
    expect(rebuilt.warnings[0].file).toBe(path.join('sidebar', 'index.html'))
    expect(ran()).toEqual(['first', 'third'])
  }, 120000)

  it('fails the build over the deleted file under EXTENSION_STRICT_REFS=true', async () => {
    process.env.EXTENSION_STRICT_REFS = 'true'

    const {files, builds, next} = session('sidebar/index')

    await next(0)
    fs.rmSync(files[1])

    const rebuilt = await next(builds.length)

    expect(rebuilt.warnings).toEqual([])
    expect(rebuilt.errors).toHaveLength(1)
    expect(rebuilt.errors[0].name).toBe('HtmlEntrypointMissing')
    expect(rebuilt.errors[0].message).toContain('second.js')
    expect(rebuilt.errors[0].message).not.toContain('ENOENT')
  }, 120000)

  it('joins the file again once it is written back', async () => {
    const {files, builds, next, ran} = session('sidebar/index')

    await next(0)
    fs.rmSync(files[1])
    await next(builds.length)
    fs.writeFileSync(files[1], 'seen.push("second again")\n')

    const rebuilt = await next(builds.length)

    expect(rebuilt).toEqual({errors: [], warnings: []})
    expect(ran()).toEqual(['first', 'second again', 'third'])
  }, 120000)
})

describe('a content script group whose classic scripts are joined, in a watch session', () => {
  it('builds the three files in order', async () => {
    const {next, ran} = session('content_scripts/content-0')

    expect(await next(0)).toEqual({errors: [], warnings: []})
    expect(ran()).toEqual(['first', 'second', 'third'])
  }, 120000)

  it('fails once over a later file that was deleted, with the manifest field', async () => {
    const {files, builds, next} = session('content_scripts/content-0')

    await next(0)
    fs.rmSync(files[1])

    const rebuilt = await next(builds.length)

    expect(rebuilt.warnings).toEqual([])
    expect(rebuilt.errors).toHaveLength(1)
    expect(rebuilt.errors[0].name).toBe('ScriptsMissingFile')
    expect(rebuilt.errors[0].message).toContain('sidebar/second.js')
    expect(rebuilt.errors[0].message).toContain('content_scripts[0].js')
    expect(rebuilt.errors[0].message).not.toContain('ENOENT')
  }, 120000)
})
