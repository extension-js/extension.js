import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {rspack} from '@rspack/core'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

// A content script that awaits at the top level, built whole the way
// `extension build` and `extension dev` compile it.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function project(files: Record<string, string>, js: string[]) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-top-level-await-'))
  )
  roots.push(root)

  const typed = js.some((file) => /\.ts$/.test(file))

  write(
    root,
    'package.json',
    JSON.stringify({
      name: 'top-level-await',
      version: '0.0.1',
      private: true,
      type: 'module',
      ...(typed ? {devDependencies: {typescript: '5.4.5'}} : {})
    })
  )

  if (typed) {
    write(root, 'tsconfig.json', JSON.stringify({compilerOptions: {}}))
  }

  write(
    root,
    path.join('src', 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'top-level-await',
      version: '1.0.0',
      permissions: ['storage'],
      content_scripts: [{matches: ['<all_urls>'], js}]
    })
  )

  for (const [rel, text] of Object.entries(files)) {
    write(root, path.join('src', rel), text)
  }

  return root
}

interface Diagnostic {
  code?: string
  message: string
  file?: string
}

// `extension build`: the shipped bundle, read through the build summary.
async function built(root: string): Promise<Diagnostic[]> {
  const {extensionBuild} = await import('../../../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {})
  )

  try {
    await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as Parameters<typeof extensionBuild>[1])

    return []
  } catch (error) {
    return (error as {diagnostics?: Diagnostic[]}).diagnostics || []
  } finally {
    for (const spy of spies) spy.mockRestore()

    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

// `extension dev`: the session bundle, which carries the reinject runtime
// plugin-reload adds, compiled once with no browser.
async function devSession(root: string): Promise<Diagnostic[]> {
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: true, path: path.join(root, 'dist', 'chrome')}
  } as Parameters<typeof webpackConfig>[1])

  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  return new Promise((resolve, reject) => {
    const compiler = rspack(config)

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) reject(error)
        else {
          resolve(
            (stats?.compilation.errors || []).map((one) => ({
              message: one.message
            }))
          )
        }
      })
    })
  })
}

const SHAPES = {build: built, dev: devSession}

// Runs the emitted content script on a page stub and returns what it logged.
async function run(root: string) {
  const dist = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )
  const page: Record<string, unknown> = {
    log: [],
    document: {
      readyState: 'complete',
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => []
    },
    console: {log() {}, warn() {}, error() {}},
    setTimeout,
    clearTimeout,
    queueMicrotask
  }
  page.globalThis = page
  page.window = page
  page.self = page

  vm.runInNewContext(
    fs.readFileSync(path.join(dist, manifest.content_scripts[0].js[0]), 'utf8'),
    page
  )

  await new Promise((resolve) => setTimeout(resolve, 20))

  return page.log
}

const REPRO =
  'const { selector } = await chrome.storage.sync.get({ selector: ".ad-banner" });\n' +
  'console.log(selector);\n'

function expectRefusal(errors: Diagnostic[], at: string) {
  const text = errors.map((one) => one.message).join('\n')

  expect(text).toContain('uses await at the top level, outside any function.')
  expect(text).toContain(`PATH ${at}`)
  expect(text).toContain('runs as a classic script')
  expect(text).toContain('(async () => {')
  expect(text).toContain('})()')
  expect(text).not.toContain('additional loader')
  expect(text).not.toContain('Top-level-await is only supported')
  // The wrapper puts over a hundred lines ahead of the source.
  expect(text).not.toMatch(/\[1\d\d:\d+\]/)
}

describe.each(
  Object.keys(SHAPES) as Array<keyof typeof SHAPES>
)('a content script that awaits at the top level, %s', (shape) => {
  const compile = SHAPES[shape]

  it('names the source file, line and column, and how to wrap the code', async () => {
    const root = project({'content/scripts.js': REPRO}, ['content/scripts.js'])
    const errors = await compile(root)

    expectRefusal(errors, 'src/content/scripts.js:1:22')

    if (shape === 'build') {
      expect(errors[0]).toMatchObject({
        code: 'E_CONTENT_SCRIPT_SYNTAX',
        file: 'src/content/scripts.js'
      })
    }
  }, 120000)

  it('names a for await loop at the top level', async () => {
    const root = project(
      {
        'content/scripts.js':
          '// for await (const x of y) in a comment comes first\n' +
          'const sources = [Promise.resolve(1)]\n' +
          '  for await (const value of sources) console.log(value)\n'
      },
      ['content/scripts.js']
    )

    expectRefusal(await compile(root), 'src/content/scripts.js:3:3')
  }, 120000)

  it('names the line of a TypeScript file as written', async () => {
    const root = project(
      {
        'content/scripts.ts':
          'interface Settings {\n' +
          '  selector: string\n' +
          '}\n' +
          'const fallback: Settings = {selector: ".ad-banner"}\n' +
          'const settings = (await chrome.storage.sync.get(fallback)) as Settings\n' +
          'console.log(settings.selector)\n'
      },
      ['content/scripts.ts']
    )

    expectRefusal(await compile(root), 'src/content/scripts.ts:5:19')
  }, 120000)
})

describe('a content script that awaits only where it may', () => {
  it('builds an await inside an async function', async () => {
    const root = project(
      {
        'content/scripts.js':
          'async function start() {\n' +
          '  globalThis.log.push(await Promise.resolve("awaited"))\n' +
          '}\n' +
          'start()\n'
      },
      ['content/scripts.js']
    )

    expect(await built(root)).toEqual([])
    expect(await run(root)).toEqual(['awaited'])
  }, 120000)

  it('builds the word await in a string and a comment', async () => {
    const root = project(
      {
        'content/scripts.js':
          '// await chrome.storage.sync.get()\n' +
          'globalThis.log.push("await is a word here")\n'
      },
      ['content/scripts.js']
    )

    expect(await built(root)).toEqual([])
    expect(await run(root)).toEqual(['await is a word here'])
  }, 120000)

  // A module the bundler runs as an async module, mounted once the await ends.
  it('builds a file with a default export and mounts it after the await', async () => {
    const root = project(
      {
        'content/scripts.js':
          'const value = await Promise.resolve("ready")\n' +
          'export default function main() {\n' +
          '  globalThis.log.push(value)\n' +
          '}\n'
      },
      ['content/scripts.js']
    )

    expect(await built(root)).toEqual([])
    expect(await run(root)).toEqual(['ready'])
  }, 120000)
})

describe('classic content scripts the build joins into one', () => {
  it('names the file that awaits at the top level', async () => {
    const root = project(
      {
        'content/first.js': 'var shared = 1\n',
        'content/second.js':
          'console.log(shared)\nconst value = await Promise.resolve(shared)\n'
      },
      ['content/first.js', 'content/second.js']
    )
    const errors = await built(root)

    expectRefusal(errors, 'src/content/second.js:2:15')
    expect(errors[0]?.code).toBe('E_CONTENT_SCRIPT_SYNTAX')
  }, 120000)
})
