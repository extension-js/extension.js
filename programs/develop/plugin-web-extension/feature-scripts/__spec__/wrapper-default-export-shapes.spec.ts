import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {rspack} from '@rspack/core'
import {Parser} from 'acorn'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {diagnosticCode} from '../../../lib/diagnostic-code'
import {readDefaultExport} from '../scripts-lib/default-export'
import contentScriptWrapper from '../steps/add-content-script-wrapper/content-script-wrapper'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(file: string, siblings: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-default-shapes-'))
  )
  roots.push(root)

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n')
  fs.mkdirSync(path.join(root, 'content'))
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'shapes',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: [`content/${file}`]}]
    })
  )

  for (const [name, text] of Object.entries(siblings)) {
    fs.writeFileSync(path.join(root, 'content', name), text)
  }

  return root
}

// The wrapper loader on one content script, as a production build runs it:
// ahead of the transpiler, on the source as it is written.
function wrap(
  source: string,
  {
    file = 'main.js',
    siblings = {}
  }: {file?: string; siblings?: Record<string, string>} = {}
) {
  const root = project(file, siblings)
  const resourcePath = path.join(root, 'content', file)
  const emitWarning = vi.fn()

  fs.writeFileSync(resourcePath, source)

  const text = String(
    contentScriptWrapper.call(
      {
        resourcePath,
        emitWarning,
        getOptions: () => ({
          manifestPath: path.join(root, 'manifest.json'),
          mode: 'production'
        })
      } as any,
      source
    )
  )
  const warnings = emitWarning.mock.calls.map(([error]) =>
    String((error as Error).message)
  )

  return {root, file, text, warnings}
}

// What the bundler's parser gets: the loader output with types and JSX gone.
function asJavaScript(text: string, file: string) {
  if (file.endsWith('.js')) return text

  return rspack.experiments.swc.transformSync(text, {
    filename: file,
    jsc: {
      parser: {syntax: 'typescript', tsx: file.endsWith('x')},
      transform: {react: {runtime: 'classic', pragma: 'h'}},
      target: 'esnext'
    },
    isModule: true
  }).code
}

// How many default exports acorn finds, or the reason it reads no module.
function defaultExports(text: string, file: string) {
  let body: any[]

  try {
    body = Parser.parse(asJavaScript(text, file), {
      ecmaVersion: 'latest',
      sourceType: 'module'
    }).body
  } catch (error) {
    return String((error as Error).message)
  }

  const named = (node: any) => node?.name ?? node?.value

  return body.filter(
    (node) =>
      node.type === 'ExportDefaultDeclaration' ||
      (node.type === 'ExportAllDeclaration' &&
        named(node.exported) === 'default') ||
      (node.type === 'ExportNamedDeclaration' &&
        node.specifiers.some((one: any) => named(one.exported) === 'default'))
  ).length
}

// Bundles the loader output in production inside the temp folder, then runs
// the bundle on a page stub and counts how often the default export ran.
async function buildAndRun({
  root,
  file,
  text
}: {
  root: string
  file: string
  text: string
}) {
  const entry = path.join(root, 'content', `wrapped${path.extname(file)}`)
  const output = path.join(root, 'dist')

  fs.writeFileSync(entry, text)

  const errors = await new Promise<string[]>((resolve, reject) => {
    const compiler = rspack({
      context: root,
      mode: 'production',
      devtool: false,
      entry: {wrapped: entry},
      output: {path: output},
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            loader: 'builtin:swc-loader',
            options: {
              jsc: {
                parser: {syntax: 'typescript', tsx: file.endsWith('x')},
                transform: {react: {runtime: 'classic', pragma: 'h'}}
              }
            }
          }
        ]
      }
    })

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) reject(error)
        else resolve((stats?.compilation.errors || []).map((e) => e.message))
      })
    })
  })
  const clicked: Array<() => void> = []
  const warned: string[] = []
  const late: string[] = []
  const page: Record<string, unknown> = {
    document: {
      readyState: 'complete',
      addEventListener(type: string, listener: () => void) {
        if (type === 'click') clicked.push(listener)
      },
      removeEventListener() {}
    },
    console: {
      log() {},
      warn: (...parts: unknown[]) => warned.push(parts.map(String).join(' ')),
      error() {}
    },
    // A timer that throws would end the test run, so its error is kept.
    setTimeout: (callback: () => void, delay: number) =>
      setTimeout(() => {
        try {
          callback()
        } catch (error) {
          late.push(String(error))
        }
      }, delay),
    clearTimeout,
    queueMicrotask
  }
  page.globalThis = page
  page.window = page
  page.self = page

  let thrown = ''

  try {
    vm.runInNewContext(
      fs.readFileSync(path.join(output, 'wrapped.js'), 'utf8'),
      page
    )
  } catch (error) {
    thrown = String(error)
  }

  await new Promise((resolve) => setTimeout(resolve, 20))

  for (const listener of clicked) {
    try {
      listener()
    } catch (error) {
      late.push(String(error))
    }
  }

  return {errors, thrown, late, warned, ran: Number(page.ran || 0), page}
}

const RUN = 'globalThis.ran = (globalThis.ran || 0) + 1'
const ONCE = {errors: [], thrown: '', late: [], warned: [], ran: 1}
const OTHER = {'other.js': `export default function () { ${RUN} }\n`}

interface Shape {
  title: string
  source: string
  file?: string
  siblings?: Record<string, string>
}

const MOUNTED_ONCE: Shape[] = [
  {
    title: 'a named function',
    source: `export default function main() { ${RUN} }\n`
  },
  {
    title: 'an anonymous function',
    source: `export default function () { ${RUN} }\n`
  },
  {
    title: 'a named async function',
    source: `export default async function main() { ${RUN} }\n`
  },
  {
    title: 'an anonymous async function',
    source: `export default async function () { ${RUN} }\n`
  },
  {title: 'an arrow function', source: `export default () => { ${RUN} }\n`},
  {
    title: 'an async arrow function',
    source: `export default async () => { ${RUN} }\n`
  },
  {
    title: 'a name declared above',
    source: `const main = () => { ${RUN} }\nexport default main\n`
  },
  {
    title: 'a name declared below',
    source: `export default main\nfunction main() { ${RUN} }\n`
  },
  {
    title: 'a call that returns the function',
    source: `const make = () => () => { ${RUN} }\nexport default make()\n`
  },
  {
    title: 'a function in parentheses',
    source: `export default (function main() { ${RUN} })\n`
  },
  {
    title: 'the keywords on separate lines with a comment between',
    source: `export /* the mount */\ndefault\nfunction main() { ${RUN} }\n`
  },
  {
    title: 'a function exported as default in a list',
    source: `function main() { ${RUN} }\nexport { main as default }\n`
  },
  {
    title:
      'a list that names default beside other exports, ahead of the declaration',
    source: `export { other, main as default }\nconst other = 1\nconst main = () => { ${RUN} }\n`
  },
  {
    title: 'a list that names default in quotes',
    source: `function main() { ${RUN} }\nexport { main as "default" }\n`
  },
  {
    title: 'the default of another module, re-exported',
    source: `export { default } from './other.js'\n`,
    siblings: OTHER
  },
  {
    title: 'a named export of another module, re-exported as default',
    source: `export { mount as default } from './other.js'\n`,
    siblings: {'other.js': `export function mount() { ${RUN} }\n`}
  },
  {
    title: 'a comment above that spells a default export',
    source:
      '// usage: export default function main() {}\n' +
      `export default function main() { ${RUN} }\n`
  },
  {
    title: 'a string, a template literal and a comment that spell one',
    source:
      'const text = "export default function text() {}"\n' +
      'const template = `export default $' +
      '{text} main()`\n' +
      `export default function main() { ${RUN} }\n` +
      '/* export default template */\n'
  },
  {
    title: 'a regular expression that spells one',
    source: `const spelled = /export default/\nexport default function main() { ${RUN} }\n`
  },
  {
    title:
      'a TypeScript function with types the transpiler has not removed yet',
    file: 'main.ts',
    source:
      'interface Marker {label: string}\n' +
      'const marker: Marker = {label: "typed"}\n' +
      `export default function main<T>(this: void, extra?: T): void { ${RUN}; void marker; void extra }\n`
  },
  {
    title: 'TypeScript overloads of one function',
    file: 'main.ts',
    source:
      'export default function main(label: string): void\n' +
      'export default function main(): void\n' +
      `export default function main(label?: string): void { ${RUN}; void label }\n`
  },
  {
    title: 'an abstract TypeScript class beside a default expression of a cast',
    file: 'main.ts',
    source:
      'abstract class Base { abstract label(): string }\n' +
      `const main = (() => { ${RUN} }) as () => void\n` +
      'export default main satisfies () => void\n' +
      'void (Base as unknown)\n'
  },
  {
    title: 'a TSX function beside JSX text with an apostrophe and a backtick',
    file: 'main.tsx',
    source:
      'const h = (...parts: unknown[]) => parts\n' +
      "const view = <p className=\"note\">it's a `mount` {'export default'}</p>\n" +
      `export default function main(): void { ${RUN}; void view }\n`
  }
]

describe('the content script wrapper on default export shapes', () => {
  for (const shape of MOUNTED_ONCE) {
    it(`mounts ${shape.title} once`, async () => {
      const wrapped = wrap(shape.source, shape)

      expect(defaultExports(wrapped.text, wrapped.file)).toBe(1)
      expect(wrapped.warnings).toEqual([])
      expect(await buildAndRun(wrapped)).toMatchObject(ONCE)
    })
  }

  it('keeps a named function a declaration: hoisted, and callable by name later', async () => {
    const wrapped = wrap(
      'globalThis.early = typeof main\n' +
        `export default function main() { ${RUN} }\n` +
        'setTimeout(() => { main() }, 1)\n' +
        "document.addEventListener('click', () => main())\n"
    )

    expect(wrapped.text).toContain(`\n function main() { ${RUN} }\n`)
    expect(defaultExports(wrapped.text, wrapped.file)).toBe(1)

    const result = await buildAndRun(wrapped)

    // Once by the wrapper, once by the timer, once by the listener.
    expect(result).toMatchObject({...ONCE, ran: 3})
    expect(result.page.early).toBe('function')
  })

  it('keeps a named class bound, and reports that a class cannot be mounted', async () => {
    const wrapped = wrap(
      'export default class App { static label = "app" }\n' +
        'globalThis.label = App.label\n'
    )

    expect(defaultExports(wrapped.text, wrapped.file)).toBe(1)

    const result = await buildAndRun(wrapped)

    expect(result).toMatchObject({errors: [], thrown: '', late: [], ran: 0})
    expect(result.page.label).toBe('app')
    expect(result.warned).toHaveLength(1)
    expect(result.warned[0]).toContain(
      'Extension.js: the content script default export failed to run.'
    )
  })

  it('ends an anonymous default export before a line that opens with a parenthesis', async () => {
    const wrapped = wrap(
      `export default function () { ${RUN} }\n` +
        '(function () { globalThis.second = true })()\n'
    )

    expect(defaultExports(wrapped.text, wrapped.file)).toBe(1)

    const result = await buildAndRun(wrapped)

    expect(result).toMatchObject(ONCE)
    expect(result.page.second).toBe(true)
  })

  it('mounts nothing for a namespace re-exported as default, and exports it once', async () => {
    const wrapped = wrap(`export * as default from './other.js'\n`, {
      siblings: OTHER
    })

    expect(defaultExports(wrapped.text, wrapped.file)).toBe(1)
    expect(await buildAndRun(wrapped)).toMatchObject({...ONCE, ran: 0})
  })

  it('leaves a file with no default export as it is written', async () => {
    const source = `const fallback = {default: 1}\n${RUN}\nvoid fallback\n`
    const wrapped = wrap(source)

    expect(wrapped.text).toContain(`\n${source}\n`)
    expect(wrapped.text).not.toContain('__EXTENSIONJS_default__')
    expect(defaultExports(wrapped.text, wrapped.file)).toBe(0)
    expect(await buildAndRun(wrapped)).toMatchObject(ONCE)
  })

  it('takes a default-exported TypeScript interface for no default export', () => {
    const wrapped = wrap(
      `export default interface Marker {label: string}\n${RUN}\n`,
      {file: 'main.ts'}
    )

    expect(wrapped.text).toContain('export default interface Marker')
    expect(wrapped.text).not.toContain('__EXTENSIONJS_default__')
  })

  it('keeps every line of the source on its line', () => {
    const source =
      'const before = 1\n' +
      'export\n  default\n  function main() {}\n' +
      'const after = before\n'
    const wrapped = wrap(source)
    const lines = wrapped.text.split('\n')
    const first = lines.indexOf('const before = 1')

    expect(lines[first + 3]).toBe('  function main() {}')
    expect(lines[first + 4]).toBe('const after = before')
  })

  it('leaves a file no parser reads to the syntax error of the build', () => {
    const source = 'export default function main( {\n'
    const wrapped = wrap(source)

    expect(wrapped.text).toContain(`\n${source}\n`)
    expect(wrapped.text).not.toContain('__EXTENSIONJS_default__')
  })

  it('deletes a call to the default export inside a timer callback', () => {
    // Pins today's behavior. Ledger 1384 D4.
    const {text, warnings} = wrap(
      'export default function main() {}\n' +
        'setTimeout(() => {\n  main()\n}, 50)\n'
    )

    expect(text).toContain(
      ' function main() {}\n' + 'setTimeout(() => {\n\n}, 50)\n'
    )

    expect(warnings).toEqual([
      'Removed direct call to main() to prevent double mount; wrapper handles mounting.'
    ])
  })
})

describe('a file the bundler reads and the wrapper cannot', () => {
  const stopped = () => ({error: 'Unexpected token (2:7)'})

  const read = (source: string) => {
    try {
      readDefaultExport(
        source,
        '/project/content/main.ts',
        'content/main.ts',
        stopped
      )
    } catch (error) {
      return error as Error
    }

    return undefined
  }

  it('stops the build with a coded error that names the file and where the parser stopped', () => {
    const error = read('export default function main(): void {}\n')

    expect(error?.name).toBe('ContentScriptSyntax')
    expect(error?.message.split('\n')).toEqual([
      '\u23f5\u23f5\u23f5 Extension.js could not read the default export of content/main.ts.',
      'PATH content/main.ts',
      'REASON Unexpected token (2:7)',
      'The build parses a content script to find the function it mounts, and the parser stopped before it reached the export, so the script would never run.',
      'Move the code named above into a module this file imports, and keep the default export in a file of plain JavaScript, TypeScript or JSX.'
    ])

    expect(
      diagnosticCode({name: 'ModuleBuildError', error: {name: error?.name}})
    ).toBe('E_CONTENT_SCRIPT_SYNTAX')
  })

  it('lets a file with no default export through', () => {
    expect(read('export const fallback: string = "default"\n')).toBeUndefined()
  })

  it('lets a file the bundler rejects through to the error of the build', () => {
    expect(read('export default function main( {\n')).toBeUndefined()
  })
})
