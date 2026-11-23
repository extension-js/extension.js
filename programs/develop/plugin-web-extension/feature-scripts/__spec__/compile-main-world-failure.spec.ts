import fs from 'node:fs'
import path from 'node:path'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {CompileMainWorldScripts} from '../steps/compile-main-world-scripts'

const tempFolder = trackTempFolders()

// A real dev build of one MAIN world group, with and without the step that
// moves it into a child compilation, written to a temp folder.
async function build(main: string, withStep: boolean) {
  const root = fs.realpathSync(tempFolder('extjs-main-failure-'))

  const at = (name: string) => path.join(root, name)

  fs.mkdirSync(at('content'))
  fs.writeFileSync(
    at('manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'main-failure',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/main.js'], world: 'MAIN'}
      ]
    })
  )

  fs.writeFileSync(at('background.js'), 'console.log("background")\n')
  fs.writeFileSync(at('content/main.js'), main)

  return new Promise<{
    errors: Array<{
      code: string
      message: string
      module: string
      file: string
    }>
    headers: string[]
    warnings: number
    emitted: string[]
  }>((resolve, reject) => {
    const compiler = rspack({
      context: root,
      mode: 'development',
      devtool: false,
      entry: {
        'background/service_worker': at('background.js'),
        'content_scripts/content-0': at('content/main.js')
      },
      output: {path: at('dist')},
      plugins: withStep
        ? [
            new CompileMainWorldScripts({
              manifestPath: at('manifest.json'),
              includeList: {},
              browser: 'chrome'
            })
          ]
        : []
    })

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error || !stats) return reject(error)

        const json = stats.toJson({all: false, errors: true, warnings: true})

        resolve({
          errors: (json.errors || []).map((e) => ({
            code: String(e.code || ''),
            message: e.message,
            module: String(e.moduleName || ''),
            file: String(e.file || '')
          })),
          // The line the bundler opens each error with in its own report.
          headers: stats
            .toString({all: false, errors: true, colors: false})
            .split('\n')
            .filter((line) => line.startsWith('ERROR in')),
          warnings: (json.warnings || []).length,
          emitted: (fs.readdirSync(at('dist'), {recursive: true}) as string[])
            .map((entry) => String(entry).split(path.sep).join('/'))
            .filter((entry) => entry.endsWith('.js'))
            .sort()
        })
      })
    })
  })
}

describe('a MAIN world group whose child compilation fails', () => {
  it('names the module when the parent compiles the group itself', async () => {
    const parent = await build('const = 1\n', false)

    expect(parent.errors.map(({module}) => module)).toEqual([
      './content/main.js'
    ])

    expect(parent.headers).toEqual(['ERROR in ./content/main.js'])
  })

  it('forwards the child error once, under the file the parent would name', async () => {
    const child = await build('const = 1\n', true)

    expect(child.errors).toHaveLength(1)
    expect(child.headers).toEqual(['ERROR in ./content/main.js'])
    // The parent has no module of the child to name, so the file says it.
    expect(child.errors[0]).toMatchObject({
      code: 'ModuleParseError',
      module: '',
      file: './content/main.js'
    })

    // One frame, the parent's: the one the child drew is not kept inside it.
    expect(child.errors[0].message).toMatch(
      /^ {2}\u00d7 Module parse failed:\n {2}\u2502 \u2570\u2500\u25b6 {3}\u00d7 JavaScript parse error: Unexpected token '=' in binding pattern/
    )

    expect(child.errors[0].message).not.toContain('MAIN world')
    expect(child.warnings).toBe(0)
    // The bundle of a failed child is not written.
    expect(child.emitted).toEqual(['background/service_worker.js'])
  })

  it('forwards an unresolved import of the child once, under the importing file', async () => {
    const child = await build('import "./missing.js"\n', true)

    expect(child.errors).toHaveLength(1)
    expect(child.headers).toEqual(['ERROR in ./content/main.js'])
    expect(child.errors[0].file).toBe('./content/main.js')
    expect(child.errors[0].message).toMatch(
      /^ {2}\u00d7 Module not found: Can't resolve '\.\/missing\.js' in '/
    )

    expect(child.emitted).toEqual(['background/service_worker.js'])
  })

  it('writes the bundle of a child that compiles', async () => {
    const child = await build('console.log("main")\n', true)

    expect(child.errors).toEqual([])
    expect(child.emitted).toEqual([
      'background/service_worker.js',
      'content_scripts/content-0.js'
    ])
  })
})
