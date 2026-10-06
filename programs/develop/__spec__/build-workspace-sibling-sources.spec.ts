import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function workspace(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-sibling-'))
  roots.push(root)

  write(root, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
  write(
    root,
    'packages/ext/package.json',
    JSON.stringify({private: true, name: 'ext', version: '0.0.0'})
  )

  write(
    root,
    'packages/ext/manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'sibling',
      version: '1.0.0',
      background: {service_worker: 'background.ts'}
    })
  )

  for (const [rel, content] of Object.entries(files)) write(root, rel, content)

  return path.join(root, 'packages', 'ext')
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

function worker(root: string) {
  return fs.readFileSync(
    path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
    'utf8'
  )
}

describe('sources outside the project root', () => {
  it('compiles a workspace sibling imported by relative path', async () => {
    const root = workspace({
      'packages/ext/background.ts': [
        "import {label, type Shape} from '../client/src/main'",
        "const shape: Shape = {name: 'ext'}",
        'console.log(label(shape))',
        ''
      ].join('\n'),
      'packages/client/package.json': JSON.stringify({
        private: true,
        name: '@fx/client',
        version: '0.0.0'
      }),
      'packages/client/src/main.ts': [
        'export interface Shape {',
        '  name: string',
        '}',
        '',
        'export function label(shape: Shape): string {',
        "  const tagged: Array<string> = ['SIBLING_TS_TOKEN', shape.name]",
        "  return tagged.join(':')",
        '}',
        ''
      ].join('\n')
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(worker(root)).toContain('SIBLING_TS_TOKEN')
  }, 120_000)

  it('lets the config hook push a rule next to the built-in ones', async () => {
    const root = workspace({
      'packages/ext/background.ts': [
        "import schema from './schema.graphql'",
        'console.log(schema)',
        ''
      ].join('\n'),
      'packages/ext/schema.graphql': 'type Query { hello: String }',
      'packages/ext/extension.config.js': [
        'module.exports = {',
        '  config: (config) => {',
        "    config.module.rules.push({test: /\\.graphql$/, type: 'asset/source'})",
        '    return config',
        '  }',
        '}',
        ''
      ].join('\n')
    })

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(worker(root)).toContain('type Query')
  }, 120_000)
})
