import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'
import {AddScripts} from '../steps/add-scripts'

const tempFolder = trackTempFolders()

type IncludeList = Record<string, string | string[]>

// A real production compile of the step alone, written to a temp folder.
// `beforeRun` runs once the step has read the list and before it is checked.
async function compile(
  include: (root: string) => IncludeList,
  beforeRun: () => void = () => {}
) {
  const root = fs.realpathSync(tempFolder('extjs-script-paths-'))

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
              // The project path keeps the platform's separators on Windows.
              .replaceAll('\\', '/')
              .split('\n')
              .map((line) => line.replace(/^ {2}[×│] ?/, ''))
              .filter(Boolean)
          }))
        })
      })
    })
  })
}

// The whole production configuration on a project written to a temp folder,
// without the plugins that start a browser.
async function buildProject(
  manifest: Record<string, unknown>,
  files: (root: string) => void = () => {}
) {
  const root = fs.realpathSync(tempFolder('extjs-script-paths-project-'))
  files(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'paths', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'paths',
      version: '1.0.0',
      ...manifest
    })
  )

  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'production',
    metadataCommand: 'build',
    silent: true,
    output: {clean: true, path: path.join(root, 'dist', 'chrome')}
  })
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-ready-contract'
  )

  config.stats = false

  return new Promise<Array<{code: string; file: string; lines: string[]}>>(
    (resolve, reject) => {
      rspack(config).run((error, stats) => {
        if (error || !stats) return reject(error)

        resolve(
          (stats.toJson({all: false, errors: true}).errors || []).map(
            (issue) => ({
              code: String(issue.code || ''),
              file: String(issue.file || ''),
              lines: issue.message
                .replaceAll(root, '<root>')
                // The project path keeps the platform's separators on Windows.
                .replaceAll('\\', '/')
                .split('\n')
                .map((line) => line.replace(/^ {2}[\u00d7\u2502] ?/, ''))
                .filter(Boolean)
            })
          )
        )
      })
    }
  )
}

const MUST_EXIST =
  'The path must point to an existing file that will be bundled.'

describe('a manifest that names files that do not exist', () => {
  it('reports a missing script and a missing stylesheet of one group apart, each under its own file', async () => {
    const errors = await buildProject({
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content/missing.js'],
          css: ['content/missing.css']
        }
      ]
    })

    expect(errors).toEqual([
      {
        code: 'ScriptsMissingFile',
        file: 'manifest.json',
        lines: [
          'content/missing.js does not exist. Check the content_scripts[0].js field in your manifest.json file.',
          MUST_EXIST,
          'NOT FOUND <root>/content/missing.js'
        ]
      },
      {
        code: 'ScriptsMissingFile',
        file: 'manifest.json',
        lines: [
          'content/missing.css does not exist. Check the content_scripts[0].css field in your manifest.json file.',
          MUST_EXIST,
          'NOT FOUND <root>/content/missing.css'
        ]
      }
    ])
  })

  it('names the list of a group each missing file came from, whatever its extension', async () => {
    const errors = await buildProject({
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content/helper', 'content/odd.css'],
          css: ['content/theme', 'content/odd.js']
        }
      ]
    })

    expect(errors.map(({lines}) => lines[0])).toEqual([
      'content/helper does not exist. Check the content_scripts[0].js field in your manifest.json file.',
      'content/odd.css does not exist. Check the content_scripts[0].js field in your manifest.json file.',
      'content/theme does not exist. Check the content_scripts[0].css field in your manifest.json file.',
      'content/odd.js does not exist. Check the content_scripts[0].css field in your manifest.json file.'
    ])
  })

  it('opens each detail with its own file when one field names two missing scripts', async () => {
    const errors = await buildProject({
      background: {service_worker: 'worker.js'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['first.js']},
        {matches: ['<all_urls>'], js: ['one.js', 'two.js']}
      ]
    })

    expect(errors.map(({lines}) => lines[0])).toEqual([
      'worker.js does not exist. Check the background.service_worker field in your manifest.json file.',
      'first.js does not exist. Check the content_scripts[0].js field in your manifest.json file.',
      'one.js does not exist. Check the content_scripts[1].js field in your manifest.json file.',
      'two.js does not exist. Check the content_scripts[1].js field in your manifest.json file.'
    ])
  })
})

// A fake env file in the project and a file a link leads to outside it.
function withheldFiles(root: string) {
  const outside = fs.realpathSync(tempFolder('extjs-script-paths-outside-'))

  fs.writeFileSync(
    path.join(root, '.env.js'),
    'globalThis.fake = "FAKE-MARKER-NOT-A-REAL-VALUE"\n'
  )

  fs.writeFileSync(path.join(outside, 'far.js'), 'globalThis.far = 1\n')
  fs.symlinkSync(path.join(outside, 'far.js'), path.join(root, 'linked.js'))
}

describe.skipIf(process.platform === 'win32')(
  'a manifest that names files the build withholds',
  () => {
    it('reports an env file and a link out of the project in full', async () => {
      const errors = await buildProject(
        {
          content_scripts: [
            {matches: ['<all_urls>'], js: ['.env.js', 'linked.js']}
          ]
        },
        withheldFiles
      )

      expect(errors).toEqual([
        {
          code: 'ScriptsMissingFile',
          file: 'manifest.json',
          lines: [
            '.env.js is not bundled. Check the content_scripts[0].js field in your manifest.json file.',
            'The build never bundles env files, tooling files or repository files. Move the code into a file with another name.',
            'NOT FOUND <root>/.env.js'
          ]
        },
        {
          code: 'ScriptsMissingFile',
          file: 'manifest.json',
          lines: [
            'linked.js is not bundled. Check the content_scripts[0].js field in your manifest.json file.',
            'The file is not one the project or its workspace shares. Move it into the project.',
            'NOT FOUND <root>/linked.js'
          ]
        }
      ])

      expect(JSON.stringify(errors)).not.toContain('FAKE-MARKER')
    })
  }
)

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
