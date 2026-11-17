import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The command decides whether a project is TypeScript before the compiler
// does. Both must read the same folders config, or the first build writes
// tsconfig.json alone and only the second one writes extension-env.d.ts.

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-first-run-ts-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'first-run-ts',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'first-run-ts',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    'background.js': 'console.log("background")\n',
    'extension.config.mjs': 'export default {folders: {pages: "src/pages"}}\n',
    ...files
  }

  for (const [name, text] of Object.entries(all)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, text)
  }

  return root
}

async function buildOnce(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalStderr = process.stderr.write.bind(process.stderr)
  const originalError = console.error
  const originalLog = console.log
  process.stderr.write = ((chunk: unknown) => {
    lines.push(String(chunk))

    return true
  }) as typeof process.stderr.write

  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  console.log = (...args: unknown[]) => lines.push(args.join(' '))

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      exitOnError: false
    } as any)
    expect(summary.errors_count, lines.join('\n')).toBe(0)
  } catch (error) {
    throw new Error(`build failed: ${String(error)}\n${lines.join('\n')}`)
  } finally {
    process.stderr.write = originalStderr
    console.error = originalError
    console.log = originalLog
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function typeScriptFiles(root: string) {
  return ['tsconfig.json', 'extension-env.d.ts'].filter((name) =>
    fs.existsSync(path.join(root, name))
  )
}

const page = (script: string) =>
  `<!doctype html><html><body><script src="./${script}"></script></body></html>\n`

describe('first build of a project whose pages folder the config moved', () => {
  it('writes tsconfig.json and extension-env.d.ts together when a moved page loads TypeScript', async () => {
    const root = project({
      'src/pages/panel.html': page('panel.ts'),
      'src/pages/panel.ts': 'const count: number = 1\nconsole.log(count)\n'
    })

    await buildOnce(root)

    expect(typeScriptFiles(root)).toEqual([
      'tsconfig.json',
      'extension-env.d.ts'
    ])

    expect(
      fs.existsSync(path.join(root, 'dist', 'chrome', 'pages', 'panel.js'))
    ).toBe(true)
  }, 120_000)

  it('writes neither file when the only TypeScript sits in the folder the config moved away from', async () => {
    const root = project({
      'src/pages/panel.html': page('panel.js'),
      'src/pages/panel.js': 'console.log("panel")\n',
      'pages/old.html': page('old.ts'),
      'pages/old.ts': 'const count: number = 1\nconsole.log(count)\n'
    })

    await buildOnce(root)

    expect(typeScriptFiles(root)).toEqual([])
  }, 120_000)
})
