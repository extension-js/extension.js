import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-resolved-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'resolved', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'resolved',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('configResolved and ?raw', () => {
  it('runs the hook with the loader rules attached and applies its changes', async () => {
    const root = project({
      'background.js':
        "import schema from './schema.graphql'\nconsole.log(schema)\n",
      'schema.graphql': 'type Query { hello: String }',
      'extension.config.js': [
        "const fs = require('node:fs')",
        "const path = require('node:path')",
        'module.exports = {',
        '  configResolved: (config) => {',
        "    fs.writeFileSync(path.join(__dirname, 'resolved.json'), JSON.stringify({rules: config.module.rules.length, hasEntry: Object.keys(config.entry || {}).length}))",
        "    config.module.rules.push({test: /\\.graphql$/, type: 'asset/source'})",
        '    return config',
        '  }',
        '}',
        ''
      ].join('\n')
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const seen = JSON.parse(
      fs.readFileSync(path.join(root, 'resolved.json'), 'utf8')
    )
    expect(seen.rules).toBeGreaterThan(3)
    expect(seen.hasEntry).toBeGreaterThan(0)

    const worker = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf8'
    )
    expect(worker).toContain('type Query')
  }, 120_000)

  it('builds an unminified bundle when the hook turns minimize off', async () => {
    const background = [
      'function describeTheInstallReason(installDetails) {',
      '  const reasonForInstall = installDetails.reason',
      "  return 'installed because ' + reasonForInstall",
      '}',
      'chrome.runtime.onInstalled.addListener((details) => {',
      '  console.log(describeTheInstallReason(details))',
      '})',
      ''
    ].join('\n')
    const hook = (body: string) =>
      `module.exports = {configResolved: (config) => {${body}}}\n`
    const worker = (root: string) =>
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
        'utf8'
      )

    const readable = project({
      'background.js': background,
      'extension.config.js': hook('config.optimization.minimize = false')
    })
    expect((await build(readable)).errors_count).toBe(0)
    expect(worker(readable)).toContain('function describeTheInstallReason(')
    expect(worker(readable)).toContain('const reasonForInstall =')

    // The same hook with nothing to say still ships a minified bundle.
    const minified = project({
      'background.js': background,
      'extension.config.js': hook('return config')
    })
    expect((await build(minified)).errors_count).toBe(0)
    expect(worker(minified)).toContain('installed because')
    expect(worker(minified)).not.toContain('reasonForInstall')
    expect(worker(minified)).not.toContain('\n')
  }, 120_000)

  it('applies resolve, resolveLoader and node changes without a warning', async () => {
    const root = project({
      'background.js':
        "import label from 'aliased-label'\nconsole.log(label, __filename)\n",
      'label.js': "export default 'ALIAS_MARK'\n",
      'loaders/mark-loader.js':
        'module.exports = (source) => source + \'\\nconsole.log("LOADER_MARK")\\n\'\n',
      'extension.config.js': [
        "const path = require('node:path')",
        'module.exports = {',
        '  configResolved: (config) => {',
        "    config.resolve.alias = {...config.resolve.alias, 'aliased-label': path.join(__dirname, 'label.js')}",
        "    config.resolveLoader = {...config.resolveLoader, alias: {'mark-loader': path.join(__dirname, 'loaders/mark-loader.js')}}",
        "    config.module.rules.push({test: /label\\.js$/, use: ['mark-loader']})",
        '    config.node = {...config.node, __filename: false}',
        '  }',
        '}',
        ''
      ].join('\n')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const summary = await build(root)
      expect(summary.errors_count).toBe(0)
      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes('configResolved')
        )
      ).toEqual([])
    } finally {
      warn.mockRestore()
    }

    const worker = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf8'
    )
    expect(worker).toContain('ALIAS_MARK')
    expect(worker).toContain('LOADER_MARK')
    expect(worker).toContain('__filename')
  }, 120_000)

  it('ignores a change to a key the engine owns and warns once', async () => {
    const root = project({
      'background.js':
        "const greetingForTheWorker = 'hello'\nconsole.log(greetingForTheWorker)\n",
      'extension.config.js': [
        "const path = require('node:path')",
        'module.exports = {',
        '  configResolved: (config) => {',
        "    config.output.path = path.join(__dirname, 'elsewhere')",
        "    config.devtool = 'source-map'",
        "    config.optimization.splitChunks.cacheGroups.mine = {name: 'mine'}",
        "    return {...config, entry: {}, mode: 'development'}",
        '  }',
        '}',
        ''
      ].join('\n')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const summary = await build(root)
      expect(summary.errors_count).toBe(0)

      const lines = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('configResolved'))

      expect(lines).toHaveLength(1)
      expect(lines[0]).not.toContain('\n')
      expect(lines[0]).toContain('set them in config instead')

      const named = lines[0]
        .slice(lines[0].indexOf('changed ') + 8, lines[0].indexOf(', which'))
        .split(', ')
        .sort()

      expect(named).toEqual([
        'devtool',
        'entry',
        'mode',
        'optimization.splitChunks.cacheGroups.mine',
        'output.path'
      ])
    } finally {
      warn.mockRestore()
    }

    // The entry still built, in production mode, into the usual folder.
    const worker = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf8'
    )
    expect(worker).toContain('hello')
    expect(worker).not.toContain('greetingForTheWorker')
    expect(fs.existsSync(path.join(root, 'elsewhere'))).toBe(false)
    expect(
      fs
        .readdirSync(path.join(root, 'dist', 'chrome', 'background'))
        .filter((name) => name.endsWith('.map'))
    ).toEqual([])
  }, 120_000)

  it('gives a ?raw import the file text', async () => {
    const root = project({
      'background.js': "import text from './notes.md?raw'\nconsole.log(text)\n",
      'notes.md': '# RAW_MARK_3f9a notes'
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const worker = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf8'
    )
    expect(worker).toContain('RAW_MARK_3f9a')
  }, 120_000)
})
