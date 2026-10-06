import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const ERRORS_FILE = 'captured-errors.json'

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-war-beside-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'war-beside-module-error',
      version: '0.0.0'
    }),
    'extension.config.js': [
      "const fs = require('node:fs')",
      "const path = require('node:path')",
      'module.exports = {',
      '  config: (config) => {',
      '    config.plugins = config.plugins || []',
      '    config.plugins.push({',
      '      apply(compiler) {',
      "        compiler.hooks.done.tap('spec-capture-errors', (stats) => {",
      '          fs.writeFileSync(',
      `            path.join(compiler.context, '${ERRORS_FILE}'),`,
      '            JSON.stringify(',
      '              stats.compilation.errors.map((error) => ({',
      '                name: error.name,',
      '                message: error.message',
      '              }))',
      '            )',
      '          )',
      '        })',
      '      }',
      '    })',
      '    return config',
      '  }',
      '}',
      ''
    ].join('\n'),
    ...files
  }

  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const printed: string[] = []

  const record = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation(record)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record)
  let failure: unknown

  try {
    await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } catch (error) {
    failure = error
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }

  const rendered = printed.join('\n').replace(/\[[0-9;]*m/g, '')
  const errors = JSON.parse(
    fs.readFileSync(path.join(root, ERRORS_FILE), 'utf-8')
  ) as Array<{name: string; message: string}>

  return {failure, rendered, errors}
}

describe('web_accessible_resources errors beside a module error (real build)', () => {
  it('reports the match pattern error in the same failed compile as the missing import', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'war-beside-module-error',
        version: '1.0.0',
        background: {service_worker: 'background.js'},
        web_accessible_resources: [
          {
            resources: ['public/beside-note.txt'],
            matches: ['beside-not-a-pattern']
          }
        ]
      }),
      'background.js': "import './beside-missing'\nconsole.log('bg')\n",
      'public/beside-note.txt': 'note\n'
    })
    const {failure, rendered, errors} = await build(root)

    expect(String(failure)).toMatch(/Build failed with errors/)
    expect(rendered).toMatch(/Build failed with 2 errors\./)

    const names = errors.map((error) => error.name)
    expect(names).toContain('WARInvalidMatchPattern')

    const warError = errors.find(
      (error) => error.name === 'WARInvalidMatchPattern'
    )
    expect(warError?.message).toMatch(/beside-not-a-pattern/)

    const moduleError = errors.find((error) =>
      /Can't resolve '\.\/beside-missing'/.test(error.message)
    )
    expect(moduleError).toBeDefined()
    expect(errors).toHaveLength(2)
  }, 120_000)

  it('reports an MV3 string entry beside the missing import', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'war-beside-module-error',
        version: '1.0.0',
        background: {service_worker: 'background.js'},
        web_accessible_resources: ['public/beside-string-entry.txt']
      }),
      'background.js': "import './beside-missing'\nconsole.log('bg')\n",
      'public/beside-string-entry.txt': 'note\n'
    })
    const {rendered, errors} = await build(root)

    expect(rendered).toMatch(/Build failed with 2 errors\./)
    expect(errors.map((error) => error.name)).toContain('WARStringEntryInMv3')
    expect(
      errors.some((error) =>
        /Can't resolve '\.\/beside-missing'/.test(error.message)
      )
    ).toBe(true)
  }, 120_000)
})
