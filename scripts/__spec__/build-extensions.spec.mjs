import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

const realScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'build-extensions.cjs'
)
const PACKAGES = ['extension-js-devtools', 'extension-js-theme']
const ENGINES = ['chromium', 'chrome', 'edge', 'firefox']
const TARGETS = [
  'build:chromium',
  'build:chrome',
  'build:firefox',
  'build:edge'
]

const fakeBuilder = [
  "const fs = require('node:fs')",
  "const path = require('node:path')",
  "const dir = path.join(__dirname, 'dist', process.argv[2])",
  'fs.mkdirSync(dir, {recursive: true})',
  "fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({name: 'fresh-' + process.argv[2], version: '1.0.0'}))",
  ''
].join('\n')

function scaffold() {
  const root = mkdtempSync(path.join(tmpdir(), 'extjs-build-extensions-'))

  mkdirSync(path.join(root, 'scripts'), {recursive: true})
  copyFileSync(realScript, path.join(root, 'scripts', 'build-extensions.cjs'))
  mkdirSync(path.join(root, 'node_modules'), {recursive: true})
  writeFileSync(path.join(root, 'node_modules', '.keep'), '')
  mkdirSync(path.join(root, 'programs', 'develop', 'dist'), {recursive: true})
  writeFileSync(
    path.join(root, 'programs', 'develop', 'dist', 'index.js'),
    'module.exports = "pipeline v1"\n'
  )

  for (const name of PACKAGES) {
    const pkgRoot = path.join(root, 'extensions', name)
    mkdirSync(pkgRoot, {recursive: true})
    writeFileSync(path.join(pkgRoot, 'build.cjs'), fakeBuilder)

    for (const engine of ENGINES) {
      mkdirSync(path.join(pkgRoot, 'dist', engine), {recursive: true})
      writeFileSync(
        path.join(pkgRoot, 'dist', engine, 'manifest.json'),
        JSON.stringify({name: 'STALE-FROM-LAST-MONTH', version: '0.0.1'})
      )
    }
  }

  return root
}

function setBuildScripts(root, outcome) {
  for (const name of PACKAGES) {
    const scripts = Object.fromEntries(
      TARGETS.map((target) => [
        target,
        outcome === 'fail'
          ? 'node -e "process.exit(1)"'
          : `node build.cjs ${target.split(':')[1]}`
      ])
    )

    writeFileSync(
      path.join(root, 'extensions', name, 'package.json'),
      JSON.stringify({name, version: '1.0.0', private: true, scripts})
    )
  }
}

function runScript(root) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'build-extensions.cjs')],
    {cwd: root, encoding: 'utf8', env: process.env}
  )
}

function mirroredManifest(root, name, engine) {
  return path.join(
    root,
    'programs',
    'develop',
    'dist',
    name,
    engine,
    'manifest.json'
  )
}

function readStamp(root, name) {
  return JSON.parse(
    readFileSync(
      path.join(root, 'programs', 'develop', 'dist', name, 'build-stamp.json'),
      'utf8'
    )
  )
}

test('a failing companion build exits non-zero, names the target and mirrors nothing', () => {
  const root = scaffold()

  try {
    setBuildScripts(root, 'fail')
    const result = runScript(root)

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /extension-js-devtools build:chromium failed with exit code 1/
    )

    assert.match(
      result.stderr,
      /Bundled extension build failed for: extension-js-devtools, extension-js-theme/
    )

    for (const name of PACKAGES) {
      assert.equal(
        existsSync(path.join(root, 'programs', 'develop', 'dist', name)),
        false
      )
    }

    assert.deepEqual(
      readdirSync(path.join(root, 'programs', 'develop', 'dist')),
      ['index.js']
    )
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('a successful rebuild mirrors the fresh bytes with a stamp for the current pipeline', () => {
  const root = scaffold()

  try {
    setBuildScripts(root, 'pass')
    const first = runScript(root)

    assert.equal(first.status, 0, first.stderr)

    for (const name of PACKAGES) {
      for (const engine of ENGINES) {
        assert.deepEqual(
          JSON.parse(
            readFileSync(mirroredManifest(root, name, engine), 'utf8')
          ),
          {name: `fresh-${engine}`, version: '1.0.0'}
        )
      }

      const stamp = readStamp(root, name)
      assert.match(stamp.pipeline, /^[0-9a-f]{64}$/)
      assert.ok(Number.isFinite(Date.parse(stamp.builtAt)))
    }

    const second = runScript(root)
    assert.equal(second.status, 0, second.stderr)
    assert.equal(
      readStamp(root, 'extension-js-theme').pipeline,
      readStamp(root, 'extension-js-devtools').pipeline
    )
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('a mirrored copy built against another pipeline fails verification instead of passing on presence', () => {
  const root = scaffold()

  try {
    setBuildScripts(root, 'pass')
    assert.equal(runScript(root).status, 0)
    const before = readStamp(root, 'extension-js-devtools').pipeline

    writeFileSync(
      path.join(root, 'programs', 'develop', 'dist', 'index.js'),
      'module.exports = "pipeline v2"\n'
    )

    setBuildScripts(root, 'fail')
    const result = runScript(root)

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /extension-js-devtools was built against another develop pipeline/
    )

    assert.match(
      result.stderr,
      /extension-js-theme was built against another develop pipeline/
    )

    assert.equal(readStamp(root, 'extension-js-devtools').pipeline, before)
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          mirroredManifest(root, 'extension-js-devtools', 'firefox'),
          'utf8'
        )
      ),
      {name: 'fresh-firefox', version: '1.0.0'}
    )
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
