import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {WarnMissingBuildConstants} from '../steps/warn-missing-build-constants'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// A real build of one background worker with the step applied, written to a
// temp folder. Returns the warnings as the step pushed them.
async function build(
  background: string,
  options: {
    mode?: 'development' | 'production'
    devSession?: boolean
    define?: Record<string, unknown>
  } = {}
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-missing-constant-'))
  )
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'constants',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), background)

  return new Promise<{errors: string[]; warnings: Array<[string, string]>}>(
    (resolve, reject) => {
      const compiler = rspack({
        context: root,
        mode: options.mode || 'production',
        devtool: false,
        entry: {'background/service_worker': path.join(root, 'background.js')},
        output: {path: path.join(root, 'dist')},
        plugins: [
          new WarnMissingBuildConstants({
            manifestPath: path.join(root, 'manifest.json'),
            browser: 'chrome',
            ...('devSession' in options
              ? {devSession: options.devSession}
              : {}),
            ...(options.define ? {define: options.define} : {})
          })
        ]
      })

      compiler.run((error, stats) => {
        compiler.close(() => {
          if (error || !stats) return reject(error)

          resolve({
            errors: stats.compilation.errors.map((e) => e.message),
            warnings: stats.compilation.warnings.map((w) => [w.name, w.message])
          })
        })
      })
    }
  )
}

describe('the step that names a build constant nothing defines', () => {
  it('warns once, naming the file, the constant and the entry', async () => {
    // Pins today's behavior.
    expect(await build('console.log(API_URL)\n')).toEqual({
      errors: [],
      warnings: [
        [
          'MissingBuildConstantWarning',
          // The bundler frames the step's text as it reports the warning.
          [
            '  \u26a0 background.js reads API_URL as it loads, but nothing defines it, so background/service_worker throws "API_URL is not defined" before it registers a listener.',
            '  \u2502 FILE background.js',
            '  \u2502 CONSTANT API_URL',
            '  \u2502 - Set it in extension.config.js: define: {API_URL: value}, or browser.<vendor>.define for a value per browser.',
            '  \u2502 - Or declare it in the file before the first read.',
            ''
          ].join('\n')
        ]
      ]
    })
  })

  it('stays quiet for a constant the config defines', async () => {
    expect(
      await build('console.log(API_URL)\n', {define: {API_URL: '"x"'}})
    ).toEqual({errors: [], warnings: []})
  })

  it('stays quiet in a dev session and warns in a dev build without one', async () => {
    const session = await build('console.log(API_URL)\n', {
      mode: 'development'
    })
    const plain = await build('console.log(API_URL)\n', {
      mode: 'development',
      devSession: false
    })

    expect(session).toEqual({errors: [], warnings: []})
    expect(plain.warnings.map(([name]) => name)).toEqual([
      'MissingBuildConstantWarning'
    ])
  })
})
