import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {builtinModules, createRequire} from 'node:module'
import * as path from 'node:path'
import * as acorn from 'acorn'
import {init, parse} from 'es-module-lexer'
import {beforeAll, describe, expect, it} from 'vitest'
import buildConfig, {
  browserEntries,
  contractsEntries,
  nodeEntries
} from '../rslib.config'

const DEVELOP_ROOT = path.resolve(import.meta.dirname, '..')
const DIST_DIR = path.join(DEVELOP_ROOT, 'dist')
const COMPILE_COMMAND = 'pnpm -C programs/develop compile'
const HAS_DIST = fs.existsSync(DIST_DIR)

// Contracts is a web-target lib of its own, so it runs in the browser too.
const WEB_ENTRIES: Record<string, string> = {
  ...browserEntries,
  ...contractsEntries
}
const ALL_ENTRIES: Record<string, string> = {...nodeEntries, ...WEB_ENTRIES}

type PackageJson = {
  main: string
  types: string
  exports: Record<string, string | Record<string, string>>
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(DEVELOP_ROOT, 'package.json'), 'utf8')
) as PackageJson

type AstNode = {type: string; [key: string]: unknown}
type Babel = {
  parseSync: (code: string, options: Record<string, unknown>) => AstNode | null
}

const babel = createRequire(import.meta.url)('@babel/core') as Babel

const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '__spec__'])

function sourceFiles(dir: string = DEVELOP_ROOT): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(full)
    }

    const isSource =
      SOURCE_FILE.test(entry.name) &&
      !entry.name.includes('.spec.') &&
      !entry.name.endsWith('.d.ts')

    return isSource ? [full] : []
  })
}

function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)

    return
  }

  if (!node || typeof node !== 'object') return

  const record = node as AstNode
  if (typeof record.type === 'string') visit(record)

  for (const [key, value] of Object.entries(record)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    if (value && typeof value === 'object') walk(value, visit)
  }
}

function calleeName(node: AstNode): string | undefined {
  const callee = node.callee as AstNode | undefined
  if (callee?.type === 'Identifier') return callee.name as string

  if (callee?.type === 'MemberExpression') {
    return ((callee.property as AstNode).name as string) || undefined
  }

  return undefined
}

function literalValue(node: AstNode | undefined): string | undefined {
  if (node?.type === 'StringLiteral') return node.value as string

  if (node?.type === 'TemplateLiteral') {
    const quasis = node.quasis as AstNode[]

    if ((node.expressions as unknown[]).length === 0 && quasis.length === 1) {
      return (quasis[0].value as {cooked: string}).cooked
    }
  }

  return undefined
}

// A literal, or a ternary whose two branches are literals (or ternaries again).
function literalBranches(node: AstNode | undefined): string[] | undefined {
  const value = literalValue(node)
  if (value !== undefined) return [value]

  if (node?.type === 'ConditionalExpression') {
    const consequent = literalBranches(node.consequent as AstNode)
    const alternate = literalBranches(node.alternate as AstNode)

    return consequent && alternate ? [...consequent, ...alternate] : undefined
  }

  return undefined
}

// resolveExistingFile([...]) names its dist file as the last literal segment of
// a path.resolve(...) candidate. Segments with a slash are source-tree paths.
function distStemsOfCandidates(node: AstNode | undefined): string[] {
  if (node?.type === 'ConditionalExpression') {
    return [
      ...distStemsOfCandidates(node.consequent as AstNode),
      ...distStemsOfCandidates(node.alternate as AstNode)
    ]
  }

  if (node?.type !== 'CallExpression' || calleeName(node) !== 'resolve') {
    return []
  }

  const args = node.arguments as AstNode[]
  const last = literalValue(args[args.length - 1])

  return last && !last.includes('/') ? [last] : []
}

type StemUse = {stem: string; where: string}

function scanDistConsumers() {
  const uses: StemUse[] = []
  const nonLiteral: string[] = []

  for (const file of sourceFiles()) {
    const code = fs.readFileSync(file, 'utf8')
    if (!/resolveDevelopDistFile|resolveExistingFile/.test(code)) continue

    const relative = path.relative(DEVELOP_ROOT, file)
    const ast = babel.parseSync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      sourceType: 'module',
      parserOpts: {
        plugins: /\.[cm]?tsx?$/.test(file)
          ? ['typescript', ...(file.endsWith('x') ? ['jsx'] : [])]
          : ['jsx']
      }
    })

    walk(ast, (node) => {
      if (node.type !== 'CallExpression') return

      const name = calleeName(node)
      const line = (node.loc as {start: {line: number}}).start.line
      const where = `${relative}:${line}`
      const args = node.arguments as AstNode[]

      if (name === 'resolveDevelopDistFile') {
        const stems = args.length === 1 ? literalBranches(args[0]) : undefined

        if (!stems) nonLiteral.push(where)
        else for (const stem of stems) uses.push({stem, where})
      }

      if (name === 'resolveExistingFile') {
        if (args[0]?.type !== 'ArrayExpression') {
          nonLiteral.push(where)

          return
        }

        for (const element of args[0].elements as AstNode[]) {
          for (const stem of distStemsOfCandidates(element)) {
            uses.push({stem, where})
          }
        }
      }
    })
  }

  return {uses, nonLiteral}
}

// `./dist/<stem>.mjs` targets of every runtime condition, so a dead or a
// mistyped export target shows up against the entry keys.
function exportedEntryStems(): StemUse[] {
  const targets = Object.entries(packageJson.exports).flatMap(
    ([subpath, value]) =>
      typeof value === 'string'
        ? [{target: value, where: `exports["${subpath}"]`}]
        : Object.entries(value)
            .filter(
              ([condition]) => !['development', 'types'].includes(condition)
            )
            .map(([condition, target]) => ({
              target,
              where: `exports["${subpath}"].${condition}`
            }))
  )

  return [...targets, {target: packageJson.main, where: 'main'}].flatMap(
    ({target, where}) => {
      const match = /^\.\/dist\/([^/*]+)\.mjs$/.exec(target)

      return match ? [{stem: match[1], where}] : []
    }
  )
}

describe('the develop build entries and their consumers', () => {
  const {uses, nonLiteral} = scanDistConsumers()
  const exported = exportedEntryStems()

  it('finds the consumers it is meant to check', () => {
    // A scan that silently finds nothing would pass every rule below.
    expect(uses.length).toBeGreaterThanOrEqual(20)
    expect(uses.map((use) => use.where)).toContainEqual(
      expect.stringMatching(/get-bridge-scripts\.ts:\d+$/)
    )
  })

  it('passes every resolveDevelopDistFile call a literal stem', () => {
    expect(
      nonLiteral,
      'These calls name their dist file with something other than a string ' +
        'literal or a ternary of literals, so no check can tie them to an ' +
        'entry in rslib.config.ts. Pass the stem as a literal.'
    ).toEqual([])
  })

  it('resolves only stems that rslib.config.ts builds', () => {
    const unknown = [...uses, ...exported]
      .filter((use) => !(use.stem in ALL_ENTRIES))
      .map((use) => `${use.where} -> ${use.stem}`)

    expect(
      unknown,
      'These consumers ask for a dist file no entry in rslib.config.ts emits, ' +
        'so the build would fail late with "Can\'t resolve loader".'
    ).toEqual([])
  })

  it('builds no entry that nothing consumes', () => {
    const consumed = new Set([...uses, ...exported].map((use) => use.stem))
    const dead = Object.keys(ALL_ENTRIES).filter((key) => !consumed.has(key))

    expect(
      dead,
      'These entries in rslib.config.ts have no resolveDevelopDistFile call, ' +
        'no resolveExistingFile candidate and no package.json export.'
    ).toEqual([])
  })

  it('points each export at the source and declaration of its entry', () => {
    const mismatches = Object.entries(packageJson.exports).flatMap(
      ([subpath, value]) => {
        if (typeof value === 'string') return []

        const stem = /^\.\/dist\/([^/]+)\.mjs$/.exec(value.import ?? '')?.[1]
        if (!stem || !(stem in ALL_ENTRIES)) return []

        const source = `./${path
          .relative(DEVELOP_ROOT, ALL_ENTRIES[stem])
          .split(path.sep)
          .join('/')}`
        const types = `./dist/${source.slice(2).replace(/\.ts$/, '.d.ts')}`
        const problems: string[] = []

        if (value.development !== source) {
          problems.push(
            `${subpath} development ${value.development} != ${source}`
          )
        }

        if (value.types !== types) {
          problems.push(`${subpath} types ${value.types} != ${types}`)
        }

        return problems
      }
    )

    expect(mismatches).toEqual([])
  })
})

const BUILTINS = new Set(builtinModules.filter((id) => !id.startsWith('_')))

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || BUILTINS.has(specifier)
}

function distFile(stem: string): string {
  return path.join(DIST_DIR, `${stem}.mjs`)
}

// Builtins reached from an entry, following its local chunks too.
function builtinImportsOf(entryFile: string): string[] {
  const seen = new Set<string>()
  const found: string[] = []
  const queue = [entryFile]

  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue

    seen.add(file)
    const source = fs.readFileSync(file, 'utf8')
    const [imports] = parse(source)
    const specifiers = imports.flatMap((entry) =>
      typeof entry.specifier === 'string' ? [entry.specifier] : []
    )
    const required = [
      ...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)
    ]

    for (const specifier of [...specifiers, ...required.map((m) => m[1])]) {
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), specifier))
      } else if (isNodeBuiltin(specifier)) {
        found.push(`${path.relative(DIST_DIR, file)}: ${specifier}`)
      }
    }
  }

  return found
}

// rslib's shims.esm.require opens every node chunk with node:module and keeps
// the require binding only where the chunk calls it.
function opensWithNodeModule(source: string): boolean {
  return /^(?:\/\/[^\n]*\n)*import\b[^;\n]*["']node:module["']/.test(source)
}

// A require() call, or require.resolve(), in a module with no top-level
// binding of its own named require.
function callsUnboundRequire(source: string): boolean {
  const program = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module'
  }) as unknown as AstNode
  const isRequire = (node: unknown) =>
    (node as AstNode | undefined)?.type === 'Identifier' &&
    (node as AstNode).name === 'require'
  const bound = (program.body as AstNode[]).some(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      (statement.declarations as AstNode[]).some((d) => isRequire(d.id))
  )
  let calls = false

  walk(program, (node) => {
    if (node.type !== 'CallExpression') return

    const callee = node.callee as AstNode
    if (isRequire(callee)) calls = true

    if (callee.type === 'MemberExpression' && isRequire(callee.object)) {
      calls = true
    }
  })

  return calls && !bound
}

function emittedEsmFiles(dir: string = DIST_DIR): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return emittedEsmFiles(full)

    return entry.name.endsWith('.mjs') ? [full] : []
  })
}

function packedFiles(): string[] {
  // npm prints an array before version 11 and a map after. Packs nothing.
  const run = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'],
    {
      cwd: DEVELOP_ROOT,
      encoding: 'utf8',
      env: {...process.env, npm_config_update_notifier: 'false'},
      // npm is npm.cmd on Windows, which Node only starts through a shell.
      shell: process.platform === 'win32'
    }
  )

  expect(run.status, run.stderr || String(run.error)).toBe(0)

  const report = JSON.parse(run.stdout) as Record<
    string,
    {files: Array<{path: string}>}
  >

  return Object.values(report)[0].files.map((file) => file.path)
}

if (!HAS_DIST) {
  console.warn(
    `[dist-entry-shape] ${DIST_DIR} does not exist, so the emitted-output ` +
      `checks are skipped. Run \`${COMPILE_COMMAND}\` to run them.`
  )
}

describe.skipIf(!HAS_DIST)(
  HAS_DIST
    ? 'the emitted develop dist'
    : `the emitted develop dist (skipped: no dist, run \`${COMPILE_COMMAND}\`)`,
  () => {
    beforeAll(async () => {
      await init()
    })

    it('emits every entry as <stem>.mjs', () => {
      const missing = Object.keys(ALL_ENTRIES).filter(
        (stem) => !fs.existsSync(distFile(stem))
      )

      expect(missing).toEqual([])
    })

    it('ships every file package.json exports, main and types name', () => {
      const named = Object.entries(packageJson.exports).flatMap(
        ([subpath, value]) =>
          typeof value === 'string'
            ? [[subpath, value]]
            : Object.entries(value)
                .filter(([condition]) => condition !== 'development')
                .map(([condition, target]) => [
                  `${subpath} ${condition}`,
                  target
                ])
      )

      const missing = [
        ...named,
        ['main', packageJson.main],
        ['types', packageJson.types]
      ].flatMap(([label, target]) => {
        const resolved = path.join(DEVELOP_ROOT, target)

        // A wildcard target needs at least one file under its folder.
        if (target.includes('*')) {
          const dir = path.dirname(resolved)
          const hasFiles = fs.existsSync(dir) && fs.readdirSync(dir).length > 0

          return hasFiles ? [] : [`${label}: ${target}`]
        }

        return fs.existsSync(resolved) ? [] : [`${label}: ${target}`]
      })

      expect(missing).toEqual([])
    })

    for (const stem of Object.keys(WEB_ENTRIES)) {
      it(`${stem}.mjs runs in the browser: no Node builtin, no require shim`, () => {
        const source = fs.readFileSync(distFile(stem), 'utf8')

        expect(
          builtinImportsOf(distFile(stem)),
          `${stem}.mjs runs inside the user's extension, where rspack refuses ` +
            `a Node builtin ("Reading from 'node:...' is not handled by ` +
            `plugins"). Keep the entry in a web-target lib with no require shim.`
        ).toEqual([])

        expect(source).not.toMatch(/createRequire/)
      })
    }

    for (const stem of Object.keys(nodeEntries)) {
      it(`${stem}.mjs runs on Node: it opens with the node:module shim`, () => {
        expect(
          opensWithNodeModule(fs.readFileSync(distFile(stem), 'utf8')),
          `${stem}.mjs does not open with an import of node:module, so the ` +
            `node lib in rslib.config.ts probably lost shims.esm.require.`
        ).toBe(true)
      })
    }

    it('declares require in every emitted file that calls it', () => {
      const unbound = emittedEsmFiles().filter((file) =>
        callsUnboundRequire(fs.readFileSync(file, 'utf8'))
      )

      expect(
        unbound.map((file) => path.relative(DIST_DIR, file)),
        'These files call require() in ESM with no createRequire binding, so ' +
          'they throw "require is not defined" when that line runs.'
      ).toEqual([])
    })

    it('packs no config declaration, spec file or unrequested source map', () => {
      const files = packedFiles()
      const wantsMaps = (buildConfig.lib ?? []).some(
        (lib) => lib.output?.sourceMap
      )
      const leaks = files.filter(
        (file) =>
          /\.config\.d\.[cm]?ts$/.test(file) ||
          file.split('/').includes('__spec__') ||
          file.includes('.spec.') ||
          (!wantsMaps && file.endsWith('.map'))
      )

      expect(files).toContain('dist/module.mjs')
      expect(leaks).toEqual([])
    }, 30000)
  }
)
