import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {AddScripts} from '../steps/add-scripts'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

type IncludeList = Record<string, string | string[]>

// A real production compile of the step alone, written to a temp folder.
// `beforeRun` runs once the step has read the list and before it is checked.
async function compile(
  include: (root: string) => IncludeList,
  beforeRun: () => void = () => {}
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-script-paths-'))
  )
  roots.push(root)

  const at = (name: string) => path.join(root, name)

  fs.writeFileSync(
    at('manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'paths', version: '1.0.0'})
  )

  fs.writeFileSync(at('present.js'), 'console.log("present")\n')

  const compiler = rspack({
    context: root,
    mode: 'production',
    devtool: false,
    entry: {present: at('present.js')},
    output: {path: at('dist')},
    plugins: [
      new AddScripts({
        manifestPath: at('manifest.json'),
        includeList: include(root),
        browser: 'chrome'
      })
    ]
  })

  beforeRun()

  return new Promise<{
    failed: string
    errors: Array<{code: string; file: string; lines: string[]}>
  }>((resolve) => {
    compiler.run((error, stats) => {
      compiler.close(() => {
        const json = stats?.toJson({all: false, errors: true})

        resolve({
          failed: error ? String(error) : '',
          errors: (json?.errors || []).map((issue) => ({
            code: String(issue.code || ''),
            file: String(issue.file || ''),
            // The bundler's frame is its own: the mark and the bar come off.
            lines: issue.message
              .replaceAll(root, '<root>')
              .split('\n')
              .map((line) => line.replace(/^ {2}[×│] ?/, ''))
              .filter(Boolean)
          }))
        })
      })
    })
  })
}

describe('the script path check of a real compilation', () => {
  it('reports a check that throws, where it used to pass with nothing said', async () => {
    let armed = false
    // A list that fails when it is read a second time, during the check.
    const failing = (files: string[]) =>
      new Proxy(files, {
        get(target, key, receiver) {
          if (armed) throw new Error('the list could not be read')

          return Reflect.get(target, key, receiver)
        }
      })
    const result = await compile(
      (root) => ({
        'content_scripts/content-0': failing([path.join(root, 'present.js')])
      }),
      () => {
        armed = true
      }
    )

    expect(result.failed).toBe('')
    expect(result.errors).toEqual([
      {
        code: 'ScriptsPathCheckFailed',
        file: 'manifest.json',
        lines: [
          'Extension.js could not finish checking the script paths in manifest.json: the list could not be read',
          'The check that every script and stylesheet the manifest names exists stopped early, so a missing file may go unreported in this build.',
          'This is a fault in Extension.js, not in your project. Run the build again, and report it if it repeats.'
        ]
      }
    ])
  })

  it('reads a path it cannot open as a missing file, and skips a remote address', async () => {
    const result = await compile((root) => ({
      'content_scripts/content-0': [
        path.join(root, 'present.js'),
        'https://cdn.example/remote.js',
        '//cdn.example/remote.js',
        path.join(root, `nul\0byte.js`),
        path.join(root, `${'long'.repeat(2000)}.js`)
      ]
    }))

    expect(result.failed).toBe('')
    expect(result.errors.map(({code}) => code)).toEqual([
      'ScriptsMissingFile',
      'ScriptsMissingFile'
    ])

    expect(result.errors.map(({lines}) => lines.at(-1)?.slice(0, 20))).toEqual([
      'NOT FOUND <root>/nul',
      'NOT FOUND <root>/lon'
    ])
  })
})
