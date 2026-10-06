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
const LOOPBACK = '127.0.0.1'
const ALLOWED_WILDCARD_LISTENS = []

function walkSpecs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) walkSpecs(full, out)
    else if (/\.spec\.ts$/.test(entry.name)) out.push(full)
  }

  return out
}

function balanced(source, openIndex) {
  let depth = 0

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]

    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
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
  const match = /^(['"])((?:\\.|(?!\1).)*)\1$/s.exec(arg ?? '')

  return match ? match[2] : null
}

function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

function isLoopbackHost(source, arg) {
  if (stringLiteral(arg) === LOOPBACK) return true
  if (!/^[A-Za-z_$][\w$]*$/.test(arg ?? '')) return false

  const bound = new RegExp(
    `(?<![\\w$])${escapeRegExp(arg)}\\s*(?::[^=,)]+)?=\\s*(['"])${escapeRegExp(LOOPBACK)}\\1`
  )

  return bound.test(source)
}

function isPortArgument(arg) {
  if (!arg) return false
  if (stringLiteral(arg) !== null) return false
  if (/^[{[]/.test(arg)) return false

  if (/^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(arg)) {
    return false
  }

  if (/^function\b/.test(arg)) return false

  return true
}

export function findWildcardListens(source) {
  const hits = []
  const listenCalls = /\.listen\s*\(/g

  for (const match of source.matchAll(listenCalls)) {
    const openIndex = match.index + match[0].length - 1
    const inner = balanced(source, openIndex)
    if (inner === null) continue

    const [port, host] = splitArgs(inner)
    if (!isPortArgument(port)) continue
    if (isLoopbackHost(source, host)) continue

    hits.push({line: lineOf(source, match.index), call: `listen(${port}`})
  }

  const socketServers = /new\s+WebSocketServer\s*\(/g

  for (const match of source.matchAll(socketServers)) {
    const openIndex = match.index + match[0].length - 1
    const inner = balanced(source, openIndex)
    if (inner === null || !/\bport\s*:/.test(inner)) continue

    const host = /\bhost\s*:\s*([^,}\n]+)/.exec(inner)?.[1]?.trim()
    if (isLoopbackHost(source, host)) continue

    hits.push({
      line: lineOf(source, match.index),
      call: 'new WebSocketServer({port'
    })
  }

  return hits
}

export function collectWildcardListens(specFiles = walkSpecs(programsDir)) {
  const findings = []

  for (const file of specFiles) {
    const spec = path.relative(root, file)
    const source = fs.readFileSync(file, 'utf8')

    for (const hit of findWildcardListens(source)) {
      findings.push({spec, ...hit})
    }
  }

  return findings
}

test('no spec under programs/ listens on the wildcard and dials loopback', () => {
  const findings = collectWildcardListens().filter(
    (hit) => !ALLOWED_WILDCARD_LISTENS.includes(hit.spec)
  )

  assert.deepEqual(
    findings.map((hit) => `${hit.spec}:${hit.line} ${hit.call}`),
    [],
    `specs binding every interface while their client dials ${LOOPBACK}:\n  ${findings
      .map((hit) => `${hit.spec}:${hit.line} ${hit.call}`)
      .join(
        '\n  '
      )}\nPass '${LOOPBACK}' as the host so a foreign loopback listener cannot answer the test.`
  )
})

test('the allowlist names only specs that still bind the wildcard', () => {
  const offending = new Set(collectWildcardListens().map((hit) => hit.spec))
  const stale = ALLOWED_WILDCARD_LISTENS.filter((spec) => !offending.has(spec))

  assert.deepEqual(stale, [], `drop these entries from the allowlist: ${stale}`)
})

test('a wildcard bind is named and a loopback bind is not', () => {
  const planted = [
    'server.listen(0, resolve)',
    "server.listen(0, '127.0.0.1', resolve)",
    'server.listen(port, () => {})',
    "const host = '127.0.0.1'",
    'blocker.listen(taken, host, resolve)',
    "function bind(port: number, host = '127.0.0.1') { server.listen(port, host, () => resolve(server)) }",
    "net.listen('/tmp/sock.pipe', () => {})",
    "new WebSocketServer({port: 0, path: '/x'})",
    "new WebSocketServer({host: '127.0.0.1', port: 0})",
    'new WebSocketServer({server, path: "/x"})'
  ].join('\n')

  assert.deepEqual(findWildcardListens(planted), [
    {line: 1, call: 'listen(0'},
    {line: 3, call: 'listen(port'},
    {line: 8, call: 'new WebSocketServer({port'}
  ])
})

test('the scanner reads the emulator lane spec, so an empty tree cannot pass', () => {
  const file = path.join(
    programsDir,
    'develop',
    'dev-server',
    '__spec__',
    'emulator-lane.spec.ts'
  )
  const source = fs.readFileSync(file, 'utf8')

  assert.ok(
    (source.match(/\.listen\s*\(/g) ?? []).length >= 3,
    'expected the emulator lane spec to still start fake servers'
  )
})
