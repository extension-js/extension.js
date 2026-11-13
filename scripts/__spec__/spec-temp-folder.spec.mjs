import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {after, test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  enterRunTempFolder,
  REAL_TEMP_ENV,
  useRealTempDirectory
} from '../lib/spec-temp-folder.mjs'
import {listScriptSpecs} from '../run-script-specs.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const runner = path.join(root, 'scripts', 'run-script-specs.mjs')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-temp-folder-'))

after(() => {
  fs.rmSync(work, {recursive: true, force: true})
})

function fakeEnv(extra = {}) {
  return {
    [REAL_TEMP_ENV]: work,
    TMPDIR: '/was/tmpdir',
    TEMP: '/was/temp',
    ...extra
  }
}

test('a run gets one folder in the real temp directory, under every name', () => {
  const env = fakeEnv()
  const run = enterRunTempFolder(env)

  try {
    assert.equal(path.dirname(run.folder), work)
    assert.ok(fs.statSync(run.folder).isDirectory())
    assert.equal(env.TMPDIR, run.folder)
    assert.equal(env.TEMP, run.folder)
    assert.equal(env.TMP, run.folder)
    assert.equal(env[REAL_TEMP_ENV], work)
  } finally {
    run.leave()
  }
})

test('leaving removes the folder with all in it and puts the names back', () => {
  const env = fakeEnv()
  const run = enterRunTempFolder(env)

  fs.mkdirSync(path.join(run.folder, 'left-by-a-spec', 'nested'), {
    recursive: true
  })

  fs.writeFileSync(path.join(run.folder, 'left-by-a-spec', 'file'), 'x')
  run.leave()
  run.leave()

  assert.equal(fs.existsSync(run.folder), false)
  assert.deepEqual(env, fakeEnv())
})

test('a name that was not set is unset again', () => {
  const env = {}
  const run = enterRunTempFolder(env)

  assert.equal(path.dirname(run.folder), os.tmpdir())
  run.leave()
  assert.deepEqual(env, {})
})

test('a spec can go back to the real temp directory by name', () => {
  const env = fakeEnv()
  const run = enterRunTempFolder(env)

  try {
    assert.equal(useRealTempDirectory(env), work)
    assert.equal(env.TMPDIR, work)
    assert.equal(env.TEMP, work)
    assert.equal(env.TMP, work)
  } finally {
    run.leave()
  }

  // Outside a run there is nothing to go back from.
  assert.equal(useRealTempDirectory({}), os.tmpdir())
})

test('the runner finds every script spec', () => {
  const specs = listScriptSpecs()

  assert.ok(specs.includes(fileURLToPath(import.meta.url)))
  assert.ok(specs.every((file) => file.endsWith('.spec.mjs')))
})

for (const outcome of ['passes', 'fails']) {
  test(`a spec that ${outcome} and removes nothing leaves nothing behind`, () => {
    const dir = fs.mkdtempSync(path.join(work, 'fixture-'))
    const seen = path.join(dir, 'seen.json')
    const spec = path.join(dir, 'leaky.spec.mjs')

    fs.writeFileSync(
      spec,
      [
        "import assert from 'node:assert/strict'",
        "import fs from 'node:fs'",
        "import os from 'node:os'",
        "import path from 'node:path'",
        "import {test} from 'node:test'",
        "test('leaks', () => {",
        "  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'leaky-'))",
        "  fs.writeFileSync(path.join(made, 'file'), 'x')",
        `  fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({made, tmp: os.tmpdir(), real: process.env.${REAL_TEMP_ENV}}))`,
        `  assert.equal(${JSON.stringify(outcome)}, 'passes')`,
        '})',
        ''
      ].join('\n')
    )

    const env = {...process.env, [REAL_TEMP_ENV]: work}

    // With this set the inner run would report to this one and run nothing.
    delete env.NODE_TEST_CONTEXT

    const result = spawnSync(process.execPath, [runner, spec], {
      encoding: 'utf8',
      env
    })
    const {made, tmp, real} = JSON.parse(fs.readFileSync(seen, 'utf8'))

    assert.equal(result.status, outcome === 'passes' ? 0 : 1, result.stderr)
    assert.equal(real, work)
    assert.equal(path.dirname(tmp), work)
    assert.equal(path.dirname(made), tmp)
    assert.equal(fs.existsSync(made), false)
    assert.equal(fs.existsSync(tmp), false)
  })
}

test('each package suite and the script suite run inside a run folder', () => {
  for (const name of ['create', 'develop', 'extension', 'install']) {
    const dir = path.join(root, 'programs', name)
    const config = fs
      .readdirSync(dir)
      .find((file) => file.startsWith('vitest.config.'))

    assert.ok(config, `${name} has a vitest config`)
    assert.ok(
      fs
        .readFileSync(path.join(dir, config), 'utf8')
        .includes("globalSetup: ['../../scripts/lib/spec-temp-folder.mjs']"),
      `${name} sets the run temp folder`
    )
  }

  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).scripts

  assert.equal(scripts['test:scripts'], 'node scripts/run-script-specs.mjs')
})
