import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {HtmlPlugin} from '../../index'

const tmpRoots: string[] = []

afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, {recursive: true, force: true})
})

// A project whose popup names one script. The script is deleted after the
// plugin read the page, which is how a page entry goes missing mid-session.
function writeProject() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-html-errors-'))
  )
  tmpRoots.push(root)
  fs.mkdirSync(path.join(root, 'popup'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'html-errors', private: true})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({manifest_version: 3, name: 'html-errors', version: '1'})
  )

  fs.writeFileSync(
    path.join(root, 'popup', 'index.html'),
    '<!doctype html><html><body><script src="./main.js"></script></body></html>'
  )

  fs.writeFileSync(path.join(root, 'popup', 'main.js'), 'console.log(1)\n')

  return root
}

function makeCompiler(root: string, includeList: Record<string, string>) {
  return rspack({
    mode: 'production',
    context: root,
    devtool: false,
    entry: {},
    output: {path: path.join(root, 'dist')},
    plugins: [
      new HtmlPlugin({
        manifestPath: path.join(root, 'manifest.json'),
        browser: 'chrome',
        devSession: false,
        includeList
      })
    ]
  })
}

function run(compiler: Compiler) {
  return new Promise<Stats>((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => {})
      if (error || !stats) return reject(error)

      resolve(stats)
    })
  })
}

const errorsOf = (stats: Stats) =>
  (stats.toJson({all: false, errors: true}).errors || []).map((error) => ({
    code: error.code,
    file: error.file,
    message: String(error.message)
  }))

describe('HandleCommonErrors', () => {
  it('names the page and the missing script once when a page entry is gone', async () => {
    const root = writeProject()
    const compiler = makeCompiler(root, {
      'action/index': path.join(root, 'popup', 'index.html')
    })
    fs.rmSync(path.join(root, 'popup', 'main.js'))

    const errors = errorsOf(await run(compiler))

    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('HtmlEntrypointMissing')
    expect(errors[0].file).toBe(path.join('popup', 'index.html'))
    expect(errors[0].message).toContain(
      "The page references a script file that doesn't exist."
    )

    expect(errors[0].message).toContain(
      `NOT FOUND ${path.join(root, 'popup', 'main.js')}`
    )
  }, 60000)

  it('still names the page when another page of the list has no file', async () => {
    const root = writeProject()
    const compiler = makeCompiler(root, {
      'sandbox/page-0': path.join(root, 'sandbox', 'gone.html'),
      'action/index': path.join(root, 'popup', 'index.html')
    })
    fs.rmSync(path.join(root, 'popup', 'main.js'))

    const errors = errorsOf(await run(compiler))

    expect(errors.map((error) => error.code)).toEqual(['HtmlEntrypointMissing'])
    expect(errors[0].file).toBe(path.join('popup', 'index.html'))
  }, 60000)

  it('rewrites in the top compilation only, never again in a child compiler', () => {
    const root = writeProject()
    const compiler = makeCompiler(root, {
      'action/index': path.join(root, 'popup', 'index.html')
    })
    const tapsOf = (hook: {taps: Array<{name: string}>}) =>
      hook.taps.map((tap) => tap.name)

    // rspack copies `compilation` taps into every child compiler and keeps
    // `thisCompilation` and `done` taps on the compiler that owns them.
    expect(tapsOf(compiler.hooks.thisCompilation)).toContain(
      'html:handle-common-errors'
    )

    expect(tapsOf(compiler.hooks.compilation)).not.toContain(
      'html:handle-common-errors'
    )

    expect(tapsOf(compiler.hooks.done)).not.toContain(
      'html:handle-common-errors:done'
    )

    compiler.close(() => {})
  })
})
