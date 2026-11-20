import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {buildProject} from '../../__spec__/helpers/build-project'

// How many times the transpiler is in the loaders of a content script module,
// read from whole builds through the module list a config hook writes.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

type Mode = 'production' | 'development'
type Browser = 'chrome' | 'firefox'

const SWC = 'builtin:swc-loader'
const CONCAT_QUERY = '__extensionjs_classic_concat__'

const CONFIG = [
  "const fs = require('node:fs')",
  "const path = require('node:path')",
  '// Lists each module with the loaders it went through, the ones joined',
  '// into another module and the ones of a child compilation included.',
  'const identifiers = (found, list = []) => {',
  '  for (const one of found.modules || []) {',
  '    list.push(one.identifier)',
  '    identifiers(one, list)',
  '  }',
  '  for (const child of found.children || []) identifiers(child, list)',
  '  return list',
  '}',
  'const listModules = {',
  '  apply(compiler) {',
  "    compiler.hooks.done.tap('list-modules', (stats) => {",
  '      const found = stats.toJson({',
  '        all: false,',
  '        modules: true,',
  '        nestedModules: true,',
  '        children: true',
  '      })',
  '      fs.writeFileSync(',
  "        path.join(__dirname, 'modules.json'),",
  '        JSON.stringify(identifiers(found))',
  '      )',
  '    })',
  '  }',
  '}',
  'module.exports = {',
  '  config: (config) => {',
  '    config.plugins.push(listModules)',
  '    return config',
  '  }',
  '}',
  ''
].join('\n')

// A stand-in JSX runtime, so a JSX content script resolves with no install.
function installReact(root: string) {
  const runtime =
    "export const Fragment = 'Fragment'\n" +
    'export function jsx(type, props) { return {type, props} }\n' +
    'export const jsxs = jsx\n' +
    'export const jsxDEV = jsx\n'

  write(
    root,
    'node_modules/react/package.json',
    JSON.stringify({
      name: 'react',
      version: '18.3.1',
      type: 'module',
      main: './index.js',
      exports: {
        '.': './index.js',
        './jsx-runtime': './jsx-runtime.js',
        './jsx-dev-runtime': './jsx-dev-runtime.js',
        './package.json': './package.json'
      }
    })
  )

  write(
    root,
    'node_modules/react/index.js',
    'export function createElement() {}\n'
  )

  write(root, 'node_modules/react/jsx-runtime.js', runtime)
  write(root, 'node_modules/react/jsx-dev-runtime.js', runtime)
}

interface Fixture {
  // The content scripts of the one manifest group, by path, in manifest order.
  scripts: Record<string, string>
  // Any other file of the project.
  files?: Record<string, string>
  world?: 'MAIN'
  tsconfig?: object
}

function project({scripts, files = {}, world, tsconfig}: Fixture) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-compiled-once-'))
  )
  roots.push(root)

  const names = Object.keys({...scripts, ...files})
  const usesJsx = names.some((name) => /\.[jt]sx$/.test(name))
  const usesTypes = names.some((name) => /\.tsx?$/.test(name))

  if (usesJsx) installReact(root)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'compiled-once',
      version: '0.0.0',
      ...(usesJsx ? {dependencies: {react: '18.3.1'}} : {}),
      ...(usesTypes ? {devDependencies: {typescript: '5.4.5'}} : {})
    })
  )

  if (usesTypes) {
    write(
      root,
      'tsconfig.json',
      JSON.stringify(
        tsconfig || {compilerOptions: {strict: true, jsx: 'preserve'}}
      )
    )
  }

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'compiled-once',
      version: '1.0.0',
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: Object.keys(scripts),
          ...(world ? {world} : {})
        }
      ]
    })
  )

  for (const [name, text] of Object.entries({
    ...scripts,
    ...files,
    'extension.config.js': CONFIG
  })) {
    write(root, name, text)
  }

  return root
}

async function build(root: string, mode: Mode, browser: Browser = 'chrome') {
  const spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {})
  )

  try {
    return await buildProject(root, {browser, mode, exitOnError: false})
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

// The transpiler runs of each module built from one file, joined ones apart.
function swcRuns(root: string, file: string) {
  const identifiers = JSON.parse(
    fs.readFileSync(path.join(root, 'modules.json'), 'utf8')
  ) as Array<string | null>
  const resource = path.join(root, ...file.split('/'))
  const built = identifiers
    .map((identifier) => String(identifier))
    .filter((identifier) => {
      const request = identifier.split('!').pop() || ''

      return request.split('|').some((part) => part.split('?')[0] === resource)
    })

  return {
    modules: built.length,
    joined: built.filter((identifier) => identifier.includes(CONCAT_QUERY))
      .length,
    runs: built.map((identifier) => identifier.split(SWC).length - 1)
  }
}

function emittedScript(root: string, browser: Browser = 'chrome') {
  const dist = path.join(root, 'dist', browser)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )

  return fs.readFileSync(
    path.join(dist, manifest.content_scripts[0].js[0]),
    'utf8'
  )
}

const MOUNT = 'export default function main() { globalThis.ran = true }\n'

const ENTRIES: Array<{title: string; fixture: Fixture; file: string}> = [
  {
    title: 'a plain entry',
    fixture: {scripts: {'content/main.js': MOUNT}},
    file: 'content/main.js'
  },
  {
    title: 'a TypeScript entry',
    fixture: {
      scripts: {
        'content/main.ts': `const said: string = 'typed'\nexport default function main(): void { globalThis.said = said }\n`
      }
    },
    file: 'content/main.ts'
  },
  {
    title: 'a JSX entry',
    fixture: {
      scripts: {
        'content/main.jsx':
          'export default function main() { globalThis.said = <p title="jsx" /> }\n'
      }
    },
    file: 'content/main.jsx'
  },
  {
    title: 'a TSX entry',
    fixture: {
      scripts: {
        'content/main.tsx': `const title: string = 'tsx'\nexport default function main(): void { globalThis.said = <p title={title} /> }\n`
      }
    },
    file: 'content/main.tsx'
  },
  {
    title: 'a MAIN world entry',
    fixture: {scripts: {'content/main.js': MOUNT}, world: 'MAIN'},
    file: 'content/main.js'
  }
]

const MODES: Mode[] = ['production', 'development']

describe('a content script entry goes through the transpiler once', () => {
  for (const mode of MODES) {
    for (const {title, fixture, file} of ENTRIES) {
      it(`${title}, ${mode}`, async () => {
        const root = project(fixture)
        const summary = await build(root, mode)

        expect(summary.errors_count).toBe(0)
        expect(swcRuns(root, file)).toEqual({modules: 1, joined: 0, runs: [1]})
      })
    }

    it(`an entry of a joined classic group, ${mode}`, async () => {
      const root = project({
        scripts: {
          'content/one.js': 'var shared = 1\n',
          'content/two.js': 'globalThis.sum = shared + 1\n'
        }
      })
      const summary = await build(root, mode)

      expect(summary.errors_count).toBe(0)
      expect(swcRuns(root, 'content/one.js')).toEqual({
        modules: 1,
        joined: 1,
        runs: [1]
      })
    })
  }

  // A production build folds the import into the entry, so only a
  // development build lists it as a module of its own.
  it('a module an entry imports', async () => {
    const root = project({
      scripts: {
        'content/main.js': `import {said} from './said'\nexport default function main() { globalThis.said = said }\n`
      },
      files: {'content/said.ts': `export const said: string = 'imported'\n`}
    })
    const summary = await build(root, 'development')

    expect(summary.errors_count).toBe(0)
    expect(swcRuns(root, 'content/main.js').runs).toEqual([1])
    expect(swcRuns(root, 'content/said.ts').runs).toEqual([1])
  })

  it('a Firefox entry', async () => {
    const root = project({scripts: {'content/main.js': MOUNT}})
    const summary = await build(root, 'production', 'firefox')

    expect(summary.errors_count).toBe(0)
    expect(swcRuns(root, 'content/main.js').runs).toEqual([1])
  })

  it('still reads the decorator settings of the project', async () => {
    const root = project({
      scripts: {
        'content/main.ts': [
          'function tag(target: any, key: string) { target[key].tagged = true }',
          'class Panel { @tag open() {} }',
          'export default function main(): void {',
          '  globalThis.said = (Panel.prototype.open as any).tagged',
          '}',
          ''
        ].join('\n')
      },
      tsconfig: {
        compilerOptions: {
          strict: false,
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        }
      }
    })
    const summary = await build(root, 'production')

    expect(summary.errors_count).toBe(0)
    expect(swcRuns(root, 'content/main.ts').runs).toEqual([1])
    // Legacy decorators with metadata, the way the tsconfig asks for them.
    expect(emittedScript(root)).toContain('design:type')
  })
})
