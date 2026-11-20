import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  droppedVitestFilters,
  droppedVitestFiltersMessage
} from '../lib/vitest-filter-args.mjs'
import {vitestArgs, vitestEnv} from '../run-vitest.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

// A package whose vitest is a stand-in that writes the argv it was given.
function makePackage() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-vitest-'))
  const vitestDir = path.join(base, 'node_modules', 'vitest')

  fs.mkdirSync(vitestDir, {recursive: true})
  fs.writeFileSync(
    path.join(vitestDir, 'package.json'),
    JSON.stringify({name: 'vitest', bin: {vitest: './vitest.mjs'}})
  )

  fs.writeFileSync(
    path.join(vitestDir, 'vitest.mjs'),
    "import fs from 'node:fs'\n" +
      "fs.writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)))\n" +
      'process.exit(7)\n'
  )

  fs.writeFileSync(path.join(base, 'package.json'), '{"name":"pkg"}')

  return base
}

test('drops the separator pnpm forwards and keeps the file filter', () => {
  assert.deepEqual(vitestArgs(['--', 'a.spec.ts']), ['run', 'a.spec.ts'])
  assert.deepEqual(vitestArgs(['a.spec.ts', '--', '-t', 'x']), [
    'run',
    'a.spec.ts',
    '-t',
    'x'
  ])

  assert.deepEqual(vitestArgs([]), ['run'])
})

test('keeps a file filter written right after the update flag', () => {
  assert.deepEqual(vitestArgs(['-u', 'a.spec.ts']), ['run', 'a.spec.ts', '-u'])
  assert.deepEqual(vitestArgs(['--update', 'a.spec.ts', '-t', 'x']), [
    'run',
    'a.spec.ts',
    '-t',
    'x',
    '--update'
  ])

  assert.deepEqual(vitestArgs(['--', '-u', 'a.spec.ts']), [
    'run',
    'a.spec.ts',
    '-u'
  ])
})

test('leaves the update flag where vitest already reads it right', () => {
  for (const argv of [
    ['a.spec.ts', '-u'],
    ['-u', 'new', 'a.spec.ts'],
    ['-u', '--bail', '1', 'a.spec.ts'],
    ['-u=all', 'a.spec.ts'],
    ['-u']
  ]) {
    assert.deepEqual(vitestArgs(argv), ['run', ...argv])
    assert.deepEqual(droppedVitestFilters(argv), [])
    assert.equal(droppedVitestFiltersMessage(argv), undefined)
  }
})

test('names every filter vitest would drop and the call that keeps them', () => {
  assert.deepEqual(droppedVitestFilters(['run', '-u', 'a.spec.ts']), [
    'a.spec.ts'
  ])

  assert.deepEqual(
    droppedVitestFilters(['run', '-u', 'a.spec.ts', '--', 'b.spec.ts']),
    ['a.spec.ts', 'b.spec.ts']
  )

  assert.equal(
    droppedVitestFiltersMessage(['run', '-u', 'a.spec.ts']),
    'vitest would drop a.spec.ts as a file filter and run the whole suite. Run it as: vitest run a.spec.ts -u'
  )

  assert.equal(
    droppedVitestFiltersMessage(['run', '--', 'a.spec.ts']),
    'vitest would drop a.spec.ts as a file filter and run the whole suite. Run it as: vitest run a.spec.ts'
  )
})

// The real vitest with the develop config: a direct call that would lose its
// filter stops while the config loads. The empty folder keeps a lost guard cheap.
for (const flags of [['-u'], ['--update'], ['--']]) {
  test(`a direct vitest run ${flags[0]} <file> in develop refuses to run the suite`, () => {
    const develop = path.join(root, 'programs', 'develop')
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'run-vitest-empty-'))
    const vitest = path.join(
      path.dirname(
        createRequire(path.join(develop, 'package.json')).resolve(
          'vitest/package.json'
        )
      ),
      'vitest.mjs'
    )

    try {
      const result = spawnSync(
        process.execPath,
        [vitest, 'run', '--dir', empty, ...flags, 'no-such-file.spec.ts'],
        {cwd: develop, encoding: 'utf8'}
      )
      const output = `${result.stdout}${result.stderr}`

      assert.notEqual(result.status, 0, output)
      assert.match(
        output,
        /vitest would drop no-such-file\.spec\.ts as a file filter and run the whole suite\. Run it as: vitest run --dir \S+ no-such-file\.spec\.ts/
      )
    } finally {
      fs.rmSync(empty, {recursive: true, force: true})
    }
  })
}

test('runs the package vitest with the filter and passes its exit code', () => {
  const base = makePackage()

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/run-vitest.mjs'), '--', 'x.spec.ts'],
      {cwd: base, encoding: 'utf8'}
    )

    assert.equal(result.status, 7)
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(base, 'argv.json'), 'utf8')),
      ['run', 'x.spec.ts']
    )
  } finally {
    fs.rmSync(base, {recursive: true, force: true})
  }
})

// The layout pnpm's isolated linker leaves, which CI installs: vitest sits in
// the virtual store and its shim puts the store's hoisted folder on NODE_PATH.
test('puts the pnpm hoisted folder on NODE_PATH as the vitest shim does', () => {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'run-vitest-'))
  )
  const store = path.join(base, 'node_modules', '.pnpm')
  const vitestDir = path.join(store, 'vitest@0.0.0', 'node_modules', 'vitest')

  try {
    fs.mkdirSync(vitestDir, {recursive: true})
    fs.writeFileSync(
      path.join(vitestDir, 'package.json'),
      JSON.stringify({name: 'vitest', bin: {vitest: './vitest.mjs'}})
    )

    fs.writeFileSync(
      path.join(vitestDir, 'vitest.mjs'),
      "import fs from 'node:fs'\n" +
        "fs.writeFileSync('node-path.txt', process.env.NODE_PATH ?? '')\n"
    )

    fs.symlinkSync(
      vitestDir,
      path.join(base, 'node_modules', 'vitest'),
      'junction'
    )

    fs.writeFileSync(path.join(base, 'package.json'), '{"name":"pkg"}')

    const result = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/run-vitest.mjs')],
      {cwd: base, encoding: 'utf8', env: {...process.env, NODE_PATH: 'kept'}}
    )

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      fs
        .readFileSync(path.join(base, 'node-path.txt'), 'utf8')
        .split(path.delimiter),
      [path.join(store, 'node_modules'), 'kept']
    )
  } finally {
    fs.rmSync(base, {recursive: true, force: true})
  }
})

test('leaves NODE_PATH alone when vitest is not in a pnpm store', () => {
  const env = {NODE_PATH: 'kept'}

  assert.deepEqual(
    vitestEnv('/repo/node_modules/vitest/package.json', env),
    env
  )
})

test('the create, develop, extension and install test scripts go through it', () => {
  for (const name of ['create', 'develop', 'extension', 'install']) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'programs', name, 'package.json'), 'utf8')
    )

    assert.equal(pkg.scripts.test, 'node ../../scripts/run-vitest.mjs', name)

    for (const [script, command] of Object.entries(pkg.scripts)) {
      assert.doesNotMatch(command, /^vitest run/, `${name} ${script}`)
    }
  }
})
