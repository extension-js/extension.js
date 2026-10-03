import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const programsDir = path.join(root, 'programs')

// A spec gated on a path that nothing produces skips on every run and nobody
// sees, so every literal existence gate must name a tree or compile output.

function walkSpecs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) walkSpecs(full, out)
    else if (/\.spec\.ts$/.test(entry.name)) out.push(full)
  }

  return out
}

// Returns the text between the parenthesis that opens at `openIndex` and its
// matching close, or null when the source is unbalanced.
function balanced(source, openIndex) {
  let depth = 0

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]

    if (ch === '(') depth++
    else if (ch === ')') {
      depth--

      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }

  return null
}

function splitArgs(text) {
  const args = []
  let depth = 0
  let current = ''

  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') depth--

    if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
    } else current += ch
  }

  if (current.trim()) args.push(current.trim())

  return args
}

function stringLiteral(arg) {
  const match = /^(['"])((?:\\.|(?!\1).)*)\1$/s.exec(arg)

  return match ? match[2] : null
}

// Only literals, path.join/resolve and identifiers resolve. Anything dynamic
// returns null so the gate is left alone rather than judged on a guess.
function resolveIdentifier(source, specDir, name, depth = 0) {
  if (depth > 16) return null
  if (name === '__dirname') return specDir

  const declaration = new RegExp(
    `(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*`,
    'g'
  )
  const match = declaration.exec(source)

  if (!match) return null

  return resolveExpression(
    source,
    specDir,
    source.slice(match.index + match[0].length),
    depth + 1
  )
}

function resolveExpression(source, specDir, text, depth = 0) {
  const trimmed = text.trimStart()
  const literal = stringLiteral(
    trimmed.match(/^(['"])(?:\\.|(?!\1).)*\1/s)?.[0] ?? ''
  )

  if (literal !== null) {
    return path.isAbsolute(literal) ? literal : path.resolve(specDir, literal)
  }

  const call = /^(?:path\.)?(join|resolve)\s*\(/.exec(trimmed)

  if (call) {
    const inner = balanced(trimmed, call[0].length - 1)
    if (inner === null) return null

    const segments = []

    for (const arg of splitArgs(inner)) {
      const asLiteral = stringLiteral(arg)

      if (asLiteral !== null) {
        segments.push(asLiteral)
        continue
      }

      if (!/^[A-Za-z_$][\w$]*$/.test(arg)) return null

      const resolved = resolveIdentifier(source, specDir, arg, depth + 1)
      if (resolved === null) return null

      segments.push(resolved)
    }

    if (segments.length === 0) return null

    return call[1] === 'resolve'
      ? path.resolve(specDir, ...segments)
      : path.resolve(specDir, path.join(...segments))
  }

  const identifier = /^[A-Za-z_$][\w$]*/.exec(trimmed)?.[0]
  if (!identifier) return null

  return resolveIdentifier(source, specDir, identifier, depth + 1)
}

// The gate shapes in use: a ternary on the call, skipIf/runIf with the call
// inline, or a const holding the result that a later skipIf/ternary reads.
const GATE_RUNNERS = '(?:it|test|describe)'
const INLINE_GATES = [
  new RegExp(
    `(?:fs\\.)?existsSync\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)\\s*\\?\\s*${GATE_RUNNERS}\\s*:\\s*${GATE_RUNNERS}\\.skip`,
    'g'
  ),
  new RegExp(
    `${GATE_RUNNERS}\\.(?:skipIf|runIf)\\(\\s*!?\\s*(?:fs\\.)?existsSync\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)\\s*\\)`,
    'g'
  )
]

function collectGateExpressions(source) {
  const expressions = []

  for (const pattern of INLINE_GATES) {
    for (const match of source.matchAll(pattern)) expressions.push(match[1])
  }

  const flagPattern =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:fs\.)?existsSync\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g

  for (const match of source.matchAll(flagPattern)) {
    const [, flag, expression] = match
    const usedAsGate = new RegExp(
      `(?:\\.(?:skipIf|runIf)\\(\\s*!?\\s*${flag}\\s*\\)|\\b${flag}\\s*\\?\\s*${GATE_RUNNERS}\\s*:\\s*${GATE_RUNNERS}\\.skip)`
    ).test(source)

    if (usedAsGate) expressions.push(expression)
  }

  return expressions
}

export function collectProgramGates(specFiles = walkSpecs(programsDir)) {
  const gates = []

  for (const file of specFiles) {
    const source = fs.readFileSync(file, 'utf8')
    const specDir = path.dirname(file)

    for (const expression of collectGateExpressions(source)) {
      const resolved = resolveExpression(source, specDir, expression)
      if (resolved === null) continue

      const relative = path.relative(programsDir, resolved)
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue

      gates.push({
        spec: path.relative(root, file),
        target: path.relative(root, resolved)
      })
    }
  }

  return gates
}

function hasCompileScript(pkg) {
  const file = path.join(programsDir, pkg, 'package.json')
  if (!fs.existsSync(file)) return false

  const scripts = JSON.parse(fs.readFileSync(file, 'utf8')).scripts ?? {}

  return typeof scripts.compile === 'string'
}

// A target is sound when it is checked in, or when it sits under the dist of a
// package that compiles and either dist is not built yet or holds the file.
export function judgeGate(gate) {
  const absolute = path.join(root, gate.target)
  if (fs.existsSync(absolute)) return null

  const [, pkg, folder] = gate.target.split(path.sep)

  if (folder === 'dist' && hasCompileScript(pkg)) {
    const distDir = path.join(programsDir, pkg, 'dist')

    if (!fs.existsSync(distDir)) return null

    return `${gate.spec} gates on ${gate.target}, which programs/${pkg} compile does not produce`
  }

  return `${gate.spec} gates on ${gate.target}, a path that is not in the tree, so its cases never run`
}

test('every existence-gated spec path under programs/ is real or compiled', () => {
  const gates = collectProgramGates()
  const failures = gates.map(judgeGate).filter(Boolean)

  assert.deepEqual(
    failures,
    [],
    `specs skipping on a path nothing produces:\n  ${failures.join('\n  ')}\nPoint the gate at the real path or delete the dead cases.`
  )
})

test('the scanner sees the built cli gate, so an empty scan cannot pass', () => {
  const gates = collectProgramGates()

  assert.ok(
    gates.some(
      (gate) =>
        gate.spec ===
          path.join(
            'programs',
            'extension',
            '__spec__',
            'exec',
            'cli-flags.contract.spec.ts'
          ) &&
        gate.target === path.join('programs', 'extension', 'dist', 'cli.cjs')
    ),
    `expected the cli-flags gate among:\n  ${gates
      .map((gate) => `${gate.spec} -> ${gate.target}`)
      .join('\n  ')}`
  )
})

test('a gate on a path nothing produces is named, a compiled one is not', () => {
  assert.match(
    judgeGate({
      spec: 'programs/x/__spec__/dead.spec.ts',
      target: path.join('programs', 'cli', 'dist', 'cli.js')
    }),
    /never run/
  )

  assert.equal(
    judgeGate({
      spec: 'programs/extension/__spec__/exec/cli-flags.contract.spec.ts',
      target: path.join('programs', 'extension', 'dist', 'cli.cjs')
    }),
    null
  )
})
