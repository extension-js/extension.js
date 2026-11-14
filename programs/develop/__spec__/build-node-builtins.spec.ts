import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

// `node:fs` and `fs` are one module to Node, so a build answers both the same
// way: the same empty module, the same fallback key, the same error.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(background: string, config?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-node-builtins-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'node-builtins', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'node-builtins',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), background)

  if (config) fs.writeFileSync(path.join(root, 'extension.config.js'), config)

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const printed: string[] = []

  const capture = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const spies = (['log', 'warn', 'error'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(capture)
  )
  let errors = 0
  let warnings = 0

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    errors = summary.errors_count
    warnings = summary.warnings_count
  } catch {
    errors = -1
  } finally {
    for (const spy of spies) spy.mockRestore()
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  return {
    errors,
    warnings,
    // eslint-disable-next-line no-control-regex
    text: printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
  }
}

function worker(root: string) {
  return fs.readFileSync(
    path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
    'utf8'
  )
}

describe('Node built-ins in extension code', () => {
  it('resolves node:fs, node:path and node:crypto to the stubs their bare names get', async () => {
    const prefixed = project(
      [
        "import fs from 'node:fs'",
        "import promises from 'node:fs/promises'",
        "import path from 'node:path'",
        "import crypto from 'node:crypto'",
        "const again = require('node:fs')",
        'console.log(fs, promises, path, crypto, again)',
        ''
      ].join('\n')
    )
    const bare = project(
      [
        "import fs from 'fs'",
        "import promises from 'fs/promises'",
        "import path from 'path'",
        "import crypto from 'crypto'",
        "const again = require('fs')",
        'console.log(fs, promises, path, crypto, again)',
        ''
      ].join('\n')
    )

    const prefixedBuild = await build(prefixed)
    const bareBuild = await build(bare)

    expect(prefixedBuild.text).not.toContain('Unhandled scheme')
    expect(prefixedBuild.errors).toBe(0)
    expect(prefixedBuild.warnings).toBe(0)
    expect(bareBuild.errors).toBe(0)
    // No polyfill rides along: the stub is the same empty module either way.
    // Module ids hash the project path, so they are the one part that differs.
    const shape = (source: string) => source.replace(/\d+/g, 'N')
    expect(shape(worker(prefixed))).toBe(shape(worker(bare)))
    expect(worker(prefixed).length).toBeLessThan(2000)
  }, 180_000)

  it('names the built-in, the importing file and resolve.fallback when there is no stub', async () => {
    for (const request of ['node:util', 'util']) {
      const root = project(`import util from '${request}'\nconsole.log(util)\n`)
      const built = await build(root)

      expect(built.errors).not.toBe(0)
      expect(built.text).not.toContain('Unhandled scheme')
      expect(built.text).toContain('The Node.js built-in util does not exist')
      expect(built.text).toContain('background.js imports it.')
      expect(built.text).toContain('Only crypto, fs, path are replaced')
      expect(built.text).toContain(
        "set resolve.fallback from the config hook: {'util': false}"
      )

      expect(built.text).toContain("require.resolve('util/')")
    }
  }, 180_000)

  it('builds once the config hook adds the fallback the error names', async () => {
    const root = project(
      "import util from 'node:util'\nimport os from 'os'\nconsole.log(util, os)\n",
      [
        'module.exports = {',
        '  config: (config) => {',
        '    config.resolve.fallback = {',
        '      ...config.resolve.fallback,',
        '      util: false,',
        "      os: require('node:path').join(__dirname, 'os-stand-in.js')",
        '    }',
        '    return config',
        '  }',
        '}',
        ''
      ].join('\n')
    )

    fs.writeFileSync(
      path.join(root, 'os-stand-in.js'),
      "export default 'os-stand-in-marker'\n"
    )

    const built = await build(root)

    expect(built.errors).toBe(0)
    expect(worker(root)).toContain('os-stand-in-marker')
  }, 180_000)

  it('says a prefix-only built-in has no fallback key and names its importer', async () => {
    const root = project("import test from 'node:test'\nconsole.log(test)\n")
    const built = await build(root)

    expect(built.errors).not.toBe(0)
    expect(built.text).toContain('The Node.js built-in node:test does not')
    expect(built.text).toContain('background.js imports it.')
    expect(built.text).toContain(
      'new rspack.NormalModuleReplacementPlugin(/^node:test$/, yourModulePath)'
    )

    expect(built.text).toContain('config: (config, {rspack}) => config')
    expect(built.text).not.toContain('Unhandled scheme')
  }, 180_000)

  it('leaves a require of an unstubbed built-in verbatim under either spelling', async () => {
    const root = project(
      "const os = require('node:os')\nconst util = require('util')\nconsole.log(os, util)\n"
    )
    const built = await build(root)

    expect(built.errors).toBe(0)
    expect(built.warnings).toBe(2)
    expect(built.text).toContain("require('node:os')")
    expect(built.text).toContain("require('util')")
    expect(built.text).toContain('It names a Node.js built-in.')
    expect(built.text).toContain("{'os': false}")
  }, 180_000)
})
