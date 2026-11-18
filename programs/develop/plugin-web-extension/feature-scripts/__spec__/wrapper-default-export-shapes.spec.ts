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
    siblings = {},
    mode = 'production'
  }: {file?: string; siblings?: Record<string, string>; mode?: string} = {}
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
          mode
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
  const listeners: Array<() => void> = []
  const warned: string[] = []
  const late: string[] = []
  const page: Record<string, unknown> = {
    document: {
      readyState: 'complete',
      addEventListener(_type: string, listener: () => void) {
        listeners.push(listener)
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

  for (const listener of listeners) {
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
})

const REMOVED = (name = 'main') => [
  `content/main.js calls ${name}() at the top level and also exports ${name} as default, so the call was left out of the build.\n` +
    'FILE content/main.js\n' +
    'Extension.js runs the default export once the page is ready, and the call would run it a second time.\n' +
    `Remove the ${name}() call, or drop the default export if the script should start itself.`
]

describe('a content script that calls its own default export', () => {
  const REMOVED_AT_TOP_LEVEL: Shape[] = [
    {
      title: 'a named function',
      source: `export default function main() { ${RUN} }\nmain()\n`
    },
    {
      title: 'a function exported in a list',
      source: `function main() { ${RUN} }\nmain();\nexport { main as default }\n`
    },
    {
      title: 'a name declared above, between statements with no semicolons',
      source:
        `const main = () => { ${RUN} }\n` +
        'export default main\n' +
        'const first = [1]\n' +
        'main()\n' +
        'first.forEach((value) => { globalThis.second = value })\n'
    }
  ]

  for (const shape of REMOVED_AT_TOP_LEVEL) {
    it(`leaves out a top-level call of ${shape.title}, and warns`, async () => {
      const wrapped = wrap(shape.source, shape)

      expect(wrapped.warnings).toEqual(REMOVED())
      expect(await buildAndRun(wrapped)).toMatchObject(ONCE)
    })
  }

  it('leaves out a top-level call of a name with a dollar sign', async () => {
    const wrapped = wrap(
      `export default function $mount() { ${RUN} }\n$mount()\n`
    )

    expect(wrapped.warnings).toEqual(REMOVED('$mount'))
    expect(await buildAndRun(wrapped)).toMatchObject(ONCE)
  })

  it('leaves out a top-level call in a TypeScript file', async () => {
    const wrapped = wrap(
      `export default function main(): void { ${RUN} }\nmain()\n`,
      {file: 'main.ts'}
    )

    expect(wrapped.warnings).toEqual([
      REMOVED()[0].replaceAll('content/main.js', 'content/main.ts')
    ])

    expect(await buildAndRun(wrapped)).toMatchObject(ONCE)
  })

  it('keeps the line of every statement after a call it leaves out', () => {
    const wrapped = wrap(
      'export default function main() {}\nmain(\n)\nconst after = 1\n'
    )

    expect(wrapped.text).toContain(
      ' function main() {}\n;\n\nconst after = 1\n'
    )
  })

  const KEPT: Shape[] = [
    {
      title: 'a timer callback',
      source:
        `export default function main() { ${RUN} }\n` +
        'setTimeout(() => {\n  main()\n}, 1)\n'
    },
    {
      title: 'a condition on the ready state',
      source:
        `export default function main() { ${RUN} }\n` +
        "if (document.readyState === 'complete') {\n  main()\n}\n"
    },
    {
      title: 'a condition with no braces',
      source:
        `export default function main() { ${RUN} }\n` +
        "if (document.readyState === 'complete')\n  main()\n"
    },
    {
      title: 'a DOMContentLoaded listener',
      source:
        `export default function main() { ${RUN} }\n` +
        "document.addEventListener('DOMContentLoaded', () => {\n  main()\n})\n"
    },
    {
      title: 'another function',
      source:
        `export default function main() { ${RUN} }\n` +
        'function start() {\n  main()\n}\nstart()\n'
    },
    {
      title: 'a block',
      source: `export default function main() { ${RUN} }\n{\n  main()\n}\n`
    },
    {
      title: 'a TypeScript timer callback',
      file: 'main.ts',
      source:
        `export default function main(): void { ${RUN} }\n` +
        'setTimeout((): void => {\n  main()\n}, 1)\n'
    }
  ]

  for (const shape of KEPT) {
    it(`keeps a call inside ${shape.title}`, async () => {
      const wrapped = wrap(shape.source, shape)

      expect(wrapped.warnings).toEqual([])
      // Once by the wrapper and once by the call the author wrote.
      expect(await buildAndRun(wrapped)).toMatchObject({...ONCE, ran: 2})
    })
  }

  it('keeps top-level calls of functions with a similar name, and calls that differ', async () => {
    const wrapped = wrap(
      `export default function main() { ${RUN} }\n` +
        'const seen = []\n' +
        'function mainLoop() { seen.push("mainLoop") }\n' +
        'function domain() { seen.push("domain") }\n' +
        'const app = {main() { seen.push("app.main") }}\n' +
        'mainLoop()\n' +
        'domain()\n' +
        'app.main()\n' +
        'main("again")\n' +
        'globalThis.seen = seen.join()\n'
    )

    expect(wrapped.warnings).toEqual([])

    const result = await buildAndRun(wrapped)

    expect(result).toMatchObject({...ONCE, ran: 2})
    expect(result.page.seen).toBe('mainLoop,domain,app.main')
  })
})

describe('the dev session hint for a default export the script also calls', () => {
  const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

  function hintsFor(source: string, mode: string, saves = 1) {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const root = project('main.js', {})
      const resourcePath = path.join(root, 'content', 'main.js')

      fs.writeFileSync(resourcePath, source)

      for (let save = 0; save < saves; save++) {
        contentScriptWrapper.call(
          {
            resourcePath,
            getOptions: () => ({
              manifestPath: path.join(root, 'manifest.json'),
              mode
            })
          } as any,
          source
        )
      }

      return log.mock.calls
        .map((call) => strip(call.map(String).join(' ')))
        .filter((line) => line.includes('runs more than once'))
    } finally {
      log.mockRestore()
    }
  }

  const CALLED_LATER =
    'export default function main() {}\n' +
    "document.addEventListener('DOMContentLoaded', () => {\n  main()\n})\n"

  it('says once per file that the function runs more than once, and why it matters', () => {
    expect(hintsFor(CALLED_LATER, 'development', 3)).toEqual([
      '\u23f5\u23f5\u23f5 content/main.js calls main() itself, and Extension.js also runs the default export once the page is ready, so main runs more than once.\n' +
        'Only the run Extension.js starts has its cleanup called before the next copy in this dev session, so what the other run adds stays on the page.\n' +
        'Remove the call if one run is what you want. Keep it if another run is intended, for example on a navigation event.'
    ])
  })

  it('says nothing in a production build', () => {
    expect(hintsFor(CALLED_LATER, 'production')).toEqual([])
  })

  it('says nothing when the only call is the top-level one it leaves out', () => {
    expect(
      hintsFor('export default function main() {}\nmain()\n', 'development')
    ).toEqual([])
  })

  it('says nothing for a function that calls itself again, as a retry does', () => {
    expect(
      hintsFor(
        'export default function main() {\n' +
          '  if (!document.body) setTimeout(() => main(), 50)\n' +
          '}\n',
        'development'
      )
    ).toEqual([])
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

  it('names the loaders that returned the text when the parser stopped in it', () => {
    let error: Error | undefined

    try {
      readDefaultExport(
        'export default function main(): void {}\n',
        '/project/content/main.ts',
        'content/main.ts',
        stopped,
        ['loaders/first.cjs', 'node_modules/second-loader/index.js']
      )
    } catch (thrown) {
      error = thrown as Error
    }

    expect(error?.name).toBe('ContentScriptSyntax')
    expect(error?.message.split('\n')).toEqual([
      '\u23f5\u23f5\u23f5 Extension.js could not find the default export of content/main.ts in what a loader returned.',
      'PATH content/main.ts',
      'LOADERS loaders/first.cjs, node_modules/second-loader/index.js',
      'REASON Unexpected token (2:7)',
      'The build parses a content script to find the function it mounts. It read this one after the loaders named above, and the parser stopped in the text they returned before it reached the export, so the script would never run.',
      'Keep the default export in what the loaders return, as plain JavaScript, TypeScript or JSX, or narrow their rule so it skips this file.'
    ])
  })

  it('lets a file the bundler rejects through to the error of the build', () => {
    expect(read('export default function main( {\n')).toBeUndefined()
  })
})
