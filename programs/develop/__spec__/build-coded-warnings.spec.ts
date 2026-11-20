import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project(
  files: Record<string, string>,
  dependencies: Record<string, string> = {}
) {
  const root = tempFolder('extjs-coded-warnings-')

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
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

  try {
    return await buildProject(root, {mode: 'production'})
  } finally {
    logSpy.mockRestore()
    warnSpy.mockRestore()
  }
}

function coded(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((line) => /^W_[A-Z0-9_]+: /.test(line))
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
      /^W_MANAGED_DEP_CONFLICT: extension\.config\.js loads its own copy of @rspack\/core \(Extension\.js ships \S+\)\.$/
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
    expect(lines[0]).toContain('W_TYPES_EMIT: Writing ')
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

// A bundler hook runs outside the scope of the build that owns it, so a line
// recorded there once went to whichever of two builds finished first.
describe('two builds running at once keep their recorded warnings apart', () => {
  type Bridge = {
    record?: (compiler: object, text: string) => void
    arrived?: () => Promise<void>
  }

  const bridge = globalThis as {__extjsCodedWarningsSpec?: Bridge}

  afterAll(() => {
    delete bridge.__extjsCodedWarningsSpec
  })

  // The hook waits until both builds stand at it, then records its own line.
  const config = (name: string) =>
    'module.exports = {config: (config) => {\n' +
    '  config.plugins.push({apply(compiler) {\n' +
    "    compiler.hooks.emit.tapPromise('spec', async () => {\n" +
    '      const bridge = globalThis.__extjsCodedWarningsSpec\n' +
    '      await bridge.arrived()\n' +
    `      bridge.record(compiler, 'recorded by ${name}')\n` +
    '    })\n' +
    '  }})\n' +
    '  return config\n}}\n'

  it('hands each build the line its own plugin hook recorded', async () => {
    const {recordCodedWarning} = await import('../lib/coded-warnings')
    const {CODES} = await import('../lib/messaging')
    let waiting = 0

    let release = () => {}

    const bothArrived = new Promise<void>((resolve) => {
      release = resolve
    })

    bridge.__extjsCodedWarningsSpec = {
      record: (compiler, text) =>
        recordCodedWarning(CODES.W_PERF_BUDGET, text, compiler),
      arrived: () => {
        waiting += 1
        if (waiting === 2) release()

        return bothArrived
      }
    }

    const first = project({
      'background.js': "console.log('first')\n",
      'extension.config.js': config('the first build')
    })
    const second = project({
      'background.js': "console.log('second')\n",
      'extension.config.js': config('the second build')
    })

    const [firstSummary, secondSummary] = await Promise.all([
      build(first),
      build(second)
    ])

    expect(waiting).toBe(2)
    expect(coded(firstSummary)).toEqual([
      'W_PERF_BUDGET: recorded by the first build'
    ])

    expect(coded(secondSummary)).toEqual([
      'W_PERF_BUDGET: recorded by the second build'
    ])
  }, 120_000)
})
