import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

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
