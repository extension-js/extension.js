import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'

// Every file in the scripts folder is an entry. A helper kept there for the
// scripts that import it ships as a file nothing loads, and the build says so.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-import-only-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'import-only',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'import-only',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    ...files
  }

  for (const [name, content] of Object.entries(all)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, content)
  }

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

  try {
    const summary = await buildProject(root, {
      silent: false,
      mode: 'production'
    })

    return {
      errors: summary.errors_count,
      warnings: summary.warnings_count,
      // eslint-disable-next-line no-control-regex
      text: printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    }
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

function emittedScripts(root: string) {
  return fs.readdirSync(path.join(root, 'dist', 'chrome', 'scripts')).sort()
}

const HELPER = "export const helper = 'helper-marker'\n"
const INJECTED = "import {helper} from './helper.js'\nconsole.log(helper)\n"
const NEEDLE = 'built as an entry of its own'

describe('a scripts folder file that other files only import', () => {
  it('is named in one line with the exclude key that leaves it out', async () => {
    const root = project({
      'background.js':
        "chrome.scripting.executeScript({files: ['scripts/injected.js']})\n",
      'scripts/helper.js': HELPER,
      'scripts/injected.js': INJECTED
    })
    const built = await build(root)

    expect(built.errors).toBe(0)
    expect(emittedScripts(root)).toEqual(['helper.js', 'injected.js'])

    const lines = built.text.split('\n').filter((line) => line.includes(NEEDLE))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('scripts/helper.js is built as an entry')
    expect(lines[0]).toContain("add exclude: ['scripts/helper.js']")
    expect(lines[0]).not.toContain('injected.js')
  }, 180_000)

  it('is quiet once exclude names the file, and the file is no longer emitted', async () => {
    const root = project({
      'background.js': "console.log('bg')\n",
      'scripts/helper.js': HELPER,
      'scripts/injected.js': INJECTED,
      'extension.config.js':
        "module.exports = {exclude: ['scripts/helper.js']}\n"
    })
    const built = await build(root)

    expect(built.errors).toBe(0)
    expect(built.warnings).toBe(0)
    expect(built.text).not.toContain(NEEDLE)
    expect(emittedScripts(root)).toEqual(['injected.js'])
  }, 180_000)

  it('is quiet when code names the output path, since that script is injected', async () => {
    const root = project({
      'background.js':
        "chrome.scripting.executeScript({files: ['scripts/helper.js']})\n",
      'scripts/helper.js': HELPER,
      'scripts/injected.js': INJECTED
    })
    const built = await build(root)

    expect(built.errors).toBe(0)
    expect(built.text).not.toContain(NEEDLE)
  }, 180_000)

  it('is quiet when no other file imports the script', async () => {
    const root = project({
      'background.js': "console.log('bg')\n",
      'scripts/alone.js': "console.log('alone')\n"
    })
    const built = await build(root)

    expect(built.errors).toBe(0)
    expect(built.warnings).toBe(0)
    expect(built.text).not.toContain(NEEDLE)
  }, 180_000)

  it('names a TypeScript helper of a moved folder by its source path', async () => {
    const root = project({
      'background.js':
        "import {helper} from './src/scripts/sender'\nconsole.log(helper)\n",
      'src/scripts/sender.ts': "export const helper: string = 'sender'\n",
      'src/scripts/bridge.ts':
        "import {helper} from './sender'\nconsole.log(helper)\n",
      'extension.config.js':
        "module.exports = {folders: {scripts: 'src/scripts'}}\n"
    })
    const built = await build(root)

    expect(built.errors).toBe(0)
    expect(built.text).toContain(
      'src/scripts/sender.ts is built as an entry of its own because every file in src/scripts/ is'
    )

    expect(built.text).toContain("add exclude: ['src/scripts/sender.ts']")
  }, 180_000)
})
