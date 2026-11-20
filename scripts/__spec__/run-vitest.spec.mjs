import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {vitestArgs} from '../run-vitest.mjs'

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

test('the create, extension and install test scripts go through it', () => {
  for (const name of ['create', 'extension', 'install']) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'programs', name, 'package.json'), 'utf8')
    )

    assert.equal(pkg.scripts.test, 'node ../../scripts/run-vitest.mjs', name)

    for (const [script, command] of Object.entries(pkg.scripts)) {
      assert.doesNotMatch(command, /^vitest run/, `${name} ${script}`)
    }
  }
})
