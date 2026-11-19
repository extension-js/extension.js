import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {diagnosticCode, NAMED_CODES} from '../diagnostic-code'
import {CODES} from '../messaging'

const developDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

// Names whose failure class has no code in the catalog yet, beside the code
// each one waits for. A row moves to NAMED_CODES when its code lands.
const AWAITING_CODE: Record<string, string> = {}

// The name a diagnostic gets when its caller passes none. It spans every
// failure class, so it stays uncoded until each caller names its own.
const UNNAMED_DEFAULTS = new Set(['ExtensionError', 'ExtensionWarning'])

// PascalCase literals that are not the name of a diagnostic this build
// reports: bundler wrappers, runtime error names, products, tap names.
const NOT_DIAGNOSTICS = new Set([
  'ModuleBuildError',
  'ModuleError',
  'ModuleWarning',
  'ModuleParseError',
  'ModuleParseWarning',
  'ModuleNotFoundError',
  'SyntaxError',
  'ChunkLoadError',
  'PostCSS',
  'TypeScript',
  'LibreWolf',
  'AbsolutePath',
  'ExtensionIconVariants',
  'AddAssetsToCompilationPlugin',
  'BaseUriRuntimeModule',
  'PublicPathRuntimeModule',
  'WebExtensionBrowserRuntime',
  'WebSocketClient'
])

const SYNTAX_NODE =
  /(?:Expression|Statement|Declaration|Declarator|Specifier|Definition|Clause|Literal|Element|Property|StaticBlock)$|^(?:Array|Object|Assignment)Pattern$/

// The control bridge names protocol errors, which the CLI maps on its own
// table, so none of them is a compilation diagnostic.
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  '__spec__',
  '.rslib',
  'control-bridge'
])
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx)$/
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/
const NAME_LITERAL = /(['"])([A-Z][A-Za-z0-9]*)\1/g
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/

function looksLikeName(literal: string): boolean {
  return (
    /[a-z]/.test(literal) &&
    (literal.match(/[A-Z]/g) || []).length > 1 &&
    !SYNTAX_NODE.test(literal)
  )
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIPPED_DIRS.has(entry.name)) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) sourceFiles(full, found)
    else if (SOURCE_FILE.test(entry.name) && !SPEC_FILE.test(entry.name)) {
      found.push(full)
    }
  }

  return found
}

// A name reaches a diagnostic by assignment, by a helper's argument or by a
// branch of a conditional, so every standalone literal of that shape counts.
function namesInSource(): Map<string, string> {
  const found = new Map<string, string>()

  for (const file of sourceFiles(developDir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')

    lines.forEach((text, index) => {
      if (COMMENT_LINE.test(text)) return

      for (const [, , literal] of text.matchAll(NAME_LITERAL)) {
        if (!looksLikeName(literal) || found.has(literal)) continue

        found.set(literal, `${path.relative(developDir, file)}:${index + 1}`)
      }
    })
  }

  return found
}

describe('the names diagnostics report under', () => {
  const names = namesInSource()

  it('finds the names the plugins set', () => {
    expect(names.get('ManifestV2OnChromiumWarning')).toMatch(
      /^rspack-config\.ts:\d+$/
    )

    expect(names.has('DNRDuplicateRuleId')).toBe(true)
    expect(names.has('WARInvalidMatchPattern')).toBe(true)
    expect(names.has('MemberExpression')).toBe(false)
  })

  it('gives every name a code or a row that says which code it waits for', () => {
    const unaccounted = [...names]
      .filter(
        ([name]) =>
          !Object.hasOwn(NAMED_CODES, name) &&
          !Object.hasOwn(AWAITING_CODE, name) &&
          !UNNAMED_DEFAULTS.has(name) &&
          !NOT_DIAGNOSTICS.has(name)
      )
      .map(([name, where]) => `${name} (${where})`)

    expect(
      unaccounted,
      'A capitalized string literal in programs/develop source is read as a diagnostic name. If it is one, map it in NAMED_CODES in lib/diagnostic-code.ts. If it is an ordinary word, add it to NOT_DIAGNOSTICS in lib/__spec__/diagnostic-names-coded.spec.ts.'
    ).toEqual([])
  })

  it('keeps one row per name', () => {
    for (const name of Object.keys(AWAITING_CODE)) {
      expect(
        NAMED_CODES,
        `${name} has a code and still waits`
      ).not.toHaveProperty(name)
    }
  })

  // A waiting row whose code now exists is a name left uncoded by accident.
  it('waits only for codes the catalog does not have', () => {
    const landed = Object.entries(AWAITING_CODE)
      .filter(([, code]) => Object.hasOwn(CODES, code))
      .map(([name, code]) => `${name} waits for ${code}`)

    expect(landed).toEqual([])
  })

  it.each(
    Object.keys(AWAITING_CODE)
  )('reports %s without a code until its code lands', (name) => {
    expect(
      diagnosticCode(Object.assign(new Error('text'), {name}))
    ).toBeUndefined()
  })

  it.each([...UNNAMED_DEFAULTS])('reports %s without a code', (name) => {
    expect(
      diagnosticCode(Object.assign(new Error('text'), {name}))
    ).toBeUndefined()
  })
})
