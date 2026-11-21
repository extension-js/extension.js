import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeProjectFiles} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// A scripts/ folder entry is compiled in a layer of its own, so a module it
// shares with the background is built twice and reports twice.
const tempFolder = trackTempFolders()
const ESCAPE = String.fromCharCode(27)
const COLOR_KEYS = ['NO_COLOR', 'FORCE_COLOR'] as const
const savedColors: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of COLOR_KEYS) {
    savedColors[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of COLOR_KEYS) {
    if (savedColors[key] === undefined) delete process.env[key]
    else process.env[key] = savedColors[key]
  }
})

function project(files: Record<string, string>) {
  const root = tempFolder('extjs-one-diagnostic-')

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'one-diagnostic',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'one-diagnostic',
      version: '1.0.0',
      background: {service_worker: 'bg.js'}
    }),
    ...files
  }

  writeProjectFiles(root, all)

  return root
}

async function build(root: string) {
  const printed: string[] = []

  const capture = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const spies = (['log', 'warn', 'error'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(capture)
  )
  let warnings = -1
  let diagnostics: unknown[] = []

  try {
    const summary = await buildProject(root, {
      silent: false,
      mode: 'production'
    })
    warnings = summary.warnings_count
  } catch (error) {
    diagnostics = (error as {diagnostics?: unknown[]}).diagnostics || []
  } finally {
    for (const spy of spies) spy.mockRestore()
  }

  return {warnings, diagnostics, raw: printed.join('\n')}
}

function count(text: string, needle: string) {
  return text.split(needle).length - 1
}

describe('a module shared by a scripts/ entry and another entry', () => {
  it('prints its warning once and counts it once', async () => {
    const root = project({
      'shared.js':
        'export async function load(name) { return import(name); }\n',
      'bg.js': "import { load } from './shared.js';\nconsole.log(load);\n",
      'scripts/inj.js':
        "import { load } from '../shared.js';\nconsole.log('inj', load);\n"
    })

    const result = await build(root)

    expect(count(result.raw, 'Critical dependency')).toBe(1)
    expect(result.warnings).toBe(1)
    // Both entries were built, so the single block is not a missing entry.
    expect(fs.existsSync(path.join(root, 'dist/chrome/scripts/inj.js'))).toBe(
      true
    )
  }, 180_000)

  it('prints its error once, counts it once, and prints it plain off a terminal', async () => {
    // A relative import that reaches a Node built-in takes the scripts/ file
    // out of the entries, so the built-in sits behind a package here.
    const root = project({
      'node_modules/dep/package.json': JSON.stringify({
        name: 'dep',
        version: '1.0.0',
        main: 'index.js',
        type: 'module'
      }),
      'node_modules/dep/index.js':
        "import { tmpdir } from 'node:os';\nexport const load = () => tmpdir();\n",
      'bg.js': "import { load } from 'dep';\nconsole.log(load);\n",
      'scripts/inj.js':
        "import { load } from 'dep';\nconsole.log('inj', load);\n"
    })

    const result = await build(root)

    expect(count(result.raw, 'Build error in')).toBe(1)
    expect(result.raw).toContain('Build failed with 1 error.')
    expect(result.diagnostics).toHaveLength(1)
    expect(result.raw).toContain("Can't resolve 'os'")
    expect(result.raw).not.toContain(ESCAPE)

    process.env.NO_COLOR = '1'
    expect((await build(root)).raw).not.toContain(ESCAPE)
    delete process.env.NO_COLOR

    process.env.FORCE_COLOR = '1'
    expect((await build(root)).raw).toContain(`${ESCAPE}[`)
  }, 240_000)
})
