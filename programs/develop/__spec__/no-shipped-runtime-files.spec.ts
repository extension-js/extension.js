import * as fs from 'node:fs'
import * as path from 'node:path'
import * as acorn from 'acorn'
import {describe, expect, it} from 'vitest'
import {
  processModuleRequest,
  processModuleSource
} from '../plugin-compilation/process-module'

const packageRoot = path.join(__dirname, '..')
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|md)$/
const SKIPPED = /(^|[\\/])(node_modules|dist|\.git|\.tmp-[^\\/]*)([\\/]|$)/

function sourceFiles(): string[] {
  return fs
    .readdirSync(packageRoot, {recursive: true})
    .map(String)
    .filter((file) => SOURCE_EXTENSIONS.test(file) && !SKIPPED.test(file))
    .filter((file) => path.join(packageRoot, file) !== __filename)
}

const read = (file: string) =>
  fs.readFileSync(path.join(packageRoot, file), 'utf8')

type Node = {type: string; [key: string]: unknown}

// Names the code reads without declaring them, which is what it needs from
// wherever it runs. Property names and declared names are not among them.
function freeNames(source: string): string[] {
  const used = new Set<string>()
  const declared = new Set<string>()

  const declare = (node: Node) => {
    if (node.type === 'Identifier') declared.add(node.name as string)
    if (node.type === 'RestElement') declare(node.argument as Node)
  }

  const visit = (node: Node, parent?: Node, key?: string) => {
    if (node.type === 'Identifier') {
      const isName =
        (parent?.type === 'Property' && key === 'key' && !parent.computed) ||
        (parent?.type === 'MemberExpression' &&
          key === 'property' &&
          !parent.computed)

      if (!isName) used.add(node.name as string)
    }

    if (node.type === 'VariableDeclarator') declare(node.id as Node)

    if (/Function/.test(node.type)) {
      for (const param of node.params as Node[]) declare(param)
    }

    for (const [childKey, child] of Object.entries(node)) {
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item && typeof (item as Node).type === 'string') {
          visit(item as Node, node, childKey)
        }
      }
    }
  }

  visit(acorn.parse(source, {ecmaVersion: 'latest'}) as unknown as Node)

  return [...used].filter((name) => !declared.has(name)).sort()
}

describe('the package ships its build output and nothing beside it', () => {
  it('publishes the dist folder only', () => {
    expect(JSON.parse(read('package.json')).files).toEqual(['dist'])
    expect(fs.existsSync(path.join(packageRoot, 'runtime'))).toBe(false)
  })

  it('names the old process shim file nowhere in its source', () => {
    const needle = ['process', 'shim'].join('-')
    const files = sourceFiles()

    expect(files.length).toBeGreaterThan(100)
    expect(files.filter((file) => read(file).includes(needle))).toEqual([])
  })

  it('provides no free variable from a file path', () => {
    const provided = sourceFiles()
      .filter((file) => !/(^|[\\/])__spec__[\\/]|\.spec\./.test(file))
      .flatMap((file) =>
        Array.from(
          read(file).matchAll(
            /new\s+[\w.]*ProvidePlugin\(\s*\{([\s\S]*?)\}\s*\)/g
          ),
          (match) => ({file: file.replace(/\\/g, '/'), value: match[1].trim()})
        )
      )

    // A path resolved from the installed package or a generated request:
    // neither can go missing the way a file beside the build output can.
    expect(provided).toEqual([
      {
        file: 'plugin-compatibility/feature-polyfill.ts',
        value: 'browser: polyfillPath'
      },
      {
        file: 'plugin-compilation/env.ts',
        value: 'process: processModuleRequest(importMetaEnvObject)'
      }
    ])

    expect(processModuleRequest({})).toMatch(
      /^data:application\/node;base64,[A-Za-z0-9+/]+=*$/
    )
  })
})

describe('the generated process module', () => {
  const env = {
    EXTENSION_PUBLIC_PLAIN: 'plain',
    EXTENSION_PUBLIC_HOSTILE:
      'a"b\'c<d>%41#e\nf\u00e9\u2028\\g`$' + '{h}</script>',
    MODE: 'production'
  }

  it('parses, and needs only what every browser context has', () => {
    for (const source of [processModuleSource({}), processModuleSource(env)]) {
      expect(freeNames(source)).toEqual([
        'BigInt',
        'Date',
        'Math',
        'Promise',
        'String',
        'console',
        'globalThis',
        'module',
        'queueMicrotask'
      ])

      expect(source).not.toMatch(/\b(require|import|eval|Function)\b/)
    }
  })

  it('exports the variables it was given, unchanged', () => {
    const module = {exports: {} as {env?: Record<string, string>}}
    new Function('module', processModuleSource(env))(module)

    expect(module.exports.env).toEqual(env)
  })
})
