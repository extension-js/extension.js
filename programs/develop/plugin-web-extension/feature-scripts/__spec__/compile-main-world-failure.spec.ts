import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {CompileMainWorldScripts} from '../steps/compile-main-world-scripts'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// A real dev build of one MAIN world group, with and without the step that
// moves it into a child compilation, written to a temp folder.
async function build(main: string, withStep: boolean) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-failure-'))
  )
  roots.push(root)

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
    errors: Array<{name: string; message: string; module: string}>
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
            name: String(e.name || ''),
            message: e.message,
            module: String(e.moduleName || '')
          })),
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
  })

  it('forwards the child error once, unframed and without its module', async () => {
    // Pins today's behavior. Ledger 1384, MAIN world child failure.
    const child = await build('const = 1\n', true)

    expect(child.errors).toHaveLength(1)
    expect(child.errors[0].module).toBe('')
    expect(child.errors[0].message).toMatch(
      /^ {2}\u00d7 Module parse failed:\n/
    )

    expect(child.errors[0].message).toContain('Unexpected token `=`')
    expect(child.errors[0].message).not.toContain('content/main.js')
    expect(child.errors[0].message).not.toContain('MAIN world')
    expect(child.warnings).toBe(0)
    // The parent still writes the bundle the child produced.
    expect(child.emitted).toEqual([
      'background/service_worker.js',
      'content_scripts/content-0.js'
    ])
  })

  it('forwards an unresolved import of the child once, naming the folder only', async () => {
    // Pins today's behavior. Ledger 1384, MAIN world child failure.
    const child = await build('import "./missing.js"\n', true)

    expect(child.errors).toHaveLength(1)
    expect(child.errors[0].module).toBe('')
    expect(child.errors[0].message).toMatch(
      /^ {2}\u00d7 Module not found: Can't resolve '\.\/missing\.js' in '/
    )

    expect(child.errors[0].message).not.toContain('main.js')
  })
})
