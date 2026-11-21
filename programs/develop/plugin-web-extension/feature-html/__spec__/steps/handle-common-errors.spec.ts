import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {HtmlPlugin} from '../../index'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'

const tempFolder = trackTempFolders()

// A project whose popup names one script. The script is deleted after the
// plugin read the page, which is how a page entry goes missing mid-session.
function writeProject() {
  const root = fs.realpathSync(tempFolder('extjs-html-errors-'))
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

const findingsOf = (stats: Stats) => {
  const json = stats.toJson({all: false, errors: true, warnings: true})
  const read = (list: typeof json.errors) =>
    (list || []).map((finding) => ({
      code: finding.code,
      file: finding.file,
      message: String(finding.message)
    }))

  return {errors: read(json.errors), warnings: read(json.warnings)}
}

async function withStrictRefs<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env.EXTENSION_STRICT_REFS
  process.env.EXTENSION_STRICT_REFS = 'true'

  try {
    return await body()
  } finally {
    if (previous === undefined) delete process.env.EXTENSION_STRICT_REFS
    else process.env.EXTENSION_STRICT_REFS = previous
  }
}

describe('HandleCommonErrors', () => {
  it('warns once, naming the page and the script, when a page entry is gone', async () => {
    const root = writeProject()
    const compiler = makeCompiler(root, {
      'action/index': path.join(root, 'popup', 'index.html')
    })
    fs.rmSync(path.join(root, 'popup', 'main.js'))

    const {errors, warnings} = findingsOf(await run(compiler))

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('HtmlEntrypointMissing')
    expect(warnings[0].file).toBe(path.join('popup', 'index.html'))
    expect(warnings[0].message).toContain(
      "The page references a script file that doesn't exist."
    )

    expect(warnings[0].message).toContain(
      `NOT FOUND ${path.join(root, 'popup', 'main.js')}`
    )
  }, 60000)

  it('fails the build over the same file under EXTENSION_STRICT_REFS', async () => {
    const root = writeProject()
    const {errors, warnings} = await withStrictRefs(async () => {
      const compiler = makeCompiler(root, {
        'action/index': path.join(root, 'popup', 'index.html')
      })
      fs.rmSync(path.join(root, 'popup', 'main.js'))

      return findingsOf(await run(compiler))
    })

    expect(warnings).toEqual([])
    expect(errors.map((error) => error.code)).toEqual(['HtmlEntrypointMissing'])
    expect(errors[0].file).toBe(path.join('popup', 'index.html'))
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

    const {errors, warnings} = findingsOf(await run(compiler))
    const missingScript = warnings.filter(
      (warning) => warning.code === 'HtmlEntrypointMissing'
    )

    expect(errors).toEqual([])
    expect(missingScript).toHaveLength(1)
    expect(missingScript[0].file).toBe(path.join('popup', 'index.html'))
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
