import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  files: Record<string, string>,
  dependencies: Record<string, string> = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-coded-warnings-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'coded-warnings',
      version: '0.0.0',
      dependencies
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'coded-warnings',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
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
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } finally {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function coded(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((line) => /^E_[A-Z0-9_]+: /.test(line))
}

describe('a build summary names the warnings the run carried on past', () => {
  it('codes a config that loads its own copy of a managed package', async () => {
    const root = project(
      {
        'background.js': "console.log('managed')\n",
        'extension.config.js':
          "const lazy = () => require('@rspack/core')\nmodule.exports = {}\n"
      },
      {'@rspack/core': '^2.0.0'}
    )

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const lines = coded(summary)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^E_MANAGED_DEP_CONFLICT: extension\.config\.js loads its own copy of @rspack\/core \(Extension\.js ships \S+\)\.$/
    )

    expect(summary.warnings_count).toBe(summary.warnings?.length)
  }, 120_000)

  it('codes a type definitions file that cannot be written', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'coded-warnings',
        version: '1.0.0',
        background: {service_worker: 'background.ts'}
      }),
      'background.ts': "console.log('types' as string)\n"
    })
    fs.mkdirSync(path.join(root, 'extension-env.d.ts'))

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const lines = coded(summary)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('E_TYPES_EMIT: Writing ')
    expect(lines[0]).toContain(path.join(root, 'extension-env.d.ts'))
    expect(lines[0]).toContain('EISDIR')
  }, 120_000)

  it('carries nothing over from an earlier build in the same process', async () => {
    const root = project({'background.js': "console.log('clean')\n"})

    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(coded(summary)).toEqual([])
  }, 120_000)
})
