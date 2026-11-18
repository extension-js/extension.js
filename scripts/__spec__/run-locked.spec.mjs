// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import assert from 'node:assert/strict'
import {spawn, spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  workspaceSourceAliases,
  workspaceSourceEntries
} from '../lib/workspace-source-entries.mjs'
import {
  acquireLock,
  isProcessAlive,
  lockDirFor,
  releaseLock
} from '../run-locked.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const runner = path.join(root, 'scripts', 'run-locked.mjs')

function makeTemp() {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-locked-'))
  )
}

// The step writes begin, holds the lock long enough to overlap, writes end.
function writeStep(dir) {
  const step = path.join(dir, 'step.mjs')

  fs.writeFileSync(
    step,
    [
      "import fs from 'node:fs'",
      'const [log, tag, code] = process.argv.slice(2)',
      'fs.appendFileSync(log, "begin " + tag + "\\n")',
      'await new Promise((resolve) => setTimeout(resolve, 400))',
      'fs.appendFileSync(log, "end " + tag + "\\n")',
      'process.exit(Number(code || 0))',
      ''
    ].join('\n')
  )

  return step
}

function runRunner(cwd, name, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, name, command], {
      cwd,
      stdio: 'ignore'
    })

    child.on('error', reject)
    child.on('close', (code) => resolve(code))
  })
}

function readLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
}

test('two runs under one lock name never overlap', async () => {
  const dir = makeTemp()

  try {
    const step = writeStep(dir)
    const log = path.join(dir, 'log.txt')
    const command = (tag) => `node "${step}" "${log}" ${tag}`
    const codes = await Promise.all([
      runRunner(dir, 'compile', command('a')),
      runRunner(dir, 'compile', command('b')),
      runRunner(dir, 'compile', command('c'))
    ])

    assert.deepEqual(codes, [0, 0, 0])

    const lines = readLines(log)

    assert.equal(lines.length, 6)

    for (let index = 0; index < lines.length; index += 2) {
      const tag = lines[index].slice('begin '.length)

      assert.equal(lines[index], `begin ${tag}`)
      assert.equal(lines[index + 1], `end ${tag}`)
    }

    assert.equal(fs.existsSync(lockDirFor(dir, 'compile')), false)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('the exit code of the command is the exit code of the run, and the lock is gone', async () => {
  const dir = makeTemp()

  try {
    const step = writeStep(dir)
    const log = path.join(dir, 'log.txt')
    const code = await runRunner(
      dir,
      'compile',
      `node "${step}" "${log}" fail 7`
    )

    assert.equal(code, 7)
    assert.equal(fs.existsSync(lockDirFor(dir, 'compile')), false)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('a lock whose holder is gone is taken over', async () => {
  const dir = makeTemp()

  try {
    const gone = spawnSync(process.execPath, ['-e', ''])
    const lockDir = lockDirFor(dir, 'compile')

    assert.equal(isProcessAlive(gone.pid), false)

    fs.mkdirSync(lockDir, {recursive: true})
    fs.writeFileSync(
      path.join(lockDir, 'owner.json'),
      JSON.stringify({pid: gone.pid})
    )

    await acquireLock(lockDir, {timeoutMs: 5000})

    const owner = JSON.parse(
      fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')
    )

    assert.equal(owner.pid, process.pid)

    releaseLock(lockDir)
    assert.equal(fs.existsSync(lockDir), false)
    assert.deepEqual(
      fs
        .readdirSync(path.dirname(lockDir))
        .filter((entry) => entry.includes('.stale-')),
      []
    )
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('a live holder keeps the lock until the deadline, and the error names the path', async () => {
  const dir = makeTemp()

  try {
    const lockDir = lockDirFor(dir, 'compile')

    await acquireLock(lockDir)
    await assert.rejects(
      acquireLock(lockDir, {timeoutMs: 200, pollMs: 20}),
      (error) =>
        error.message.includes(lockDir) &&
        error.message.includes(String(process.pid))
    )

    // A release by a process that does not hold the lock leaves it in place.
    releaseLock(lockDir, process.pid + 1)
    assert.equal(fs.existsSync(lockDir), true)

    releaseLock(lockDir)
    assert.equal(fs.existsSync(lockDir), false)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('the develop compile runs under the lock and one lib emits declarations', () => {
  const scripts = JSON.parse(
    fs.readFileSync(
      path.join(root, 'programs', 'develop', 'package.json'),
      'utf8'
    )
  ).scripts
  const config = fs.readFileSync(
    path.join(root, 'programs', 'develop', 'rslib.config.ts'),
    'utf8'
  )

  assert.ok(
    scripts.compile.startsWith('node ../../scripts/run-locked.mjs compile ')
  )

  assert.ok(scripts.compile.includes('rslib build'))
  assert.equal(config.split('dts: shouldGenerateDts').length - 1, 1)
})

test('the typecheck resolves workspace packages to source, not to dist', () => {
  const tsconfig = JSON.parse(
    fs
      .readFileSync(path.join(root, 'tsconfig.json'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
  )
  const paths = tsconfig.compilerOptions.paths

  // The typecheck and the specs of the CLI read one map, so they cannot differ.
  assert.deepEqual(
    paths,
    Object.fromEntries(
      Object.entries(workspaceSourceEntries).map(([specifier, file]) => [
        specifier,
        [`./${file}`]
      ])
    )
  )

  for (const file of Object.values(workspaceSourceEntries)) {
    assert.ok(fs.existsSync(path.join(root, file)), file)
  }

  // Every typed entry needs a source file, or that entry falls back to dist.
  for (const name of ['create', 'develop', 'install']) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'programs', name, 'package.json'), 'utf8')
    )

    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      if (typeof entry !== 'object' || !entry.types) continue

      const specifier = path.posix.join(manifest.name, subpath)

      assert.ok(
        workspaceSourceEntries[specifier]?.startsWith(`programs/${name}/`),
        `${specifier} has no source file in workspace-source-entries.mjs`
      )
    }
  }
})

test('the specs of the CLI read the sibling packages from the same map', () => {
  const config = fs.readFileSync(
    path.join(root, 'programs', 'extension', 'vitest.config.ts'),
    'utf8'
  )
  const aliases = workspaceSourceAliases(root)

  assert.ok(config.includes('alias: workspaceSourceAliases()'))
  assert.equal(aliases.length, Object.keys(workspaceSourceEntries).length)

  const [preview] = aliases.filter(({find}) =>
    find.test('extension-develop/preview')
  )

  assert.equal(
    preview.replacement,
    path.join(root, 'programs', 'develop', 'preview-entry.ts')
  )

  // A deeper import of a package is not an entry and keeps its own path.
  assert.deepEqual(
    aliases.filter(({find}) => find.test('extension-develop/contract/a.json')),
    []
  )
})
