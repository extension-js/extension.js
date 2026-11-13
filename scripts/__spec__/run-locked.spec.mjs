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
  assert.ok(scripts.compile.includes('write-dist-js-aliases.mjs'))
  assert.equal(config.split('dts: shouldGenerateDts').length - 1, 1)
})

test('the typecheck resolves workspace packages to source, not to dist', () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).scripts
  const develop = JSON.parse(
    fs.readFileSync(
      path.join(root, 'programs', 'develop', 'package.json'),
      'utf8'
    )
  )
  const passes = scripts.typecheck.split('&&')

  assert.equal(passes.length, 2)

  for (const pass of passes) {
    assert.ok(pass.includes('--customConditions development'), pass)
  }

  // Every typed entry needs a source target, or that entry falls back to dist.
  for (const [subpath, entry] of Object.entries(develop.exports)) {
    if (typeof entry !== 'object' || !entry.types) continue

    assert.ok(
      typeof entry.development === 'string' &&
        entry.development.endsWith('.ts') &&
        fs.existsSync(
          path.join(root, 'programs', 'develop', entry.development)
        ),
      `exports["${subpath}"] has no source file under "development"`
    )

    assert.equal(Object.keys(entry)[0], 'development')
  }
})
