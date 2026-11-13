// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const LOCK_PREFIX = 'node ../../scripts/run-locked.mjs '
const BUILD = 'rslib build'

function readJson(...segments) {
  return JSON.parse(fs.readFileSync(path.join(root, ...segments), 'utf8'))
}

// Every workspace package whose build config asks for declarations.
function declarationPackages() {
  const programs = path.join(root, 'programs')

  return fs
    .readdirSync(programs)
    .sort()
    .filter((name) => {
      const config = path.join(programs, name, 'rslib.config.ts')

      return (
        fs.existsSync(config) &&
        fs.readFileSync(config, 'utf8').includes('dts:')
      )
    })
}

function lockName(script) {
  if (!script.startsWith(LOCK_PREFIX)) return null

  return script.slice(LOCK_PREFIX.length).split(' ')[0]
}

function filesUnder(dir, extensions) {
  return fs
    .readdirSync(dir, {withFileTypes: true})
    .filter(
      (entry) => entry.isFile() && extensions.includes(path.extname(entry.name))
    )
    .map((entry) => path.join(dir, entry.name))
}

test('the four programs are the packages that write declarations', () => {
  assert.deepEqual(declarationPackages(), [
    'create',
    'develop',
    'extension',
    'install'
  ])

  assert.equal(fs.existsSync(path.join(root, 'packages')), false)
})

test('every script that builds a declaration package holds a lock, compile and watch each their own', () => {
  for (const name of declarationPackages()) {
    const scripts = readJson('programs', name, 'package.json').scripts

    assert.equal(lockName(scripts.compile), 'compile', `${name} compile`)
    assert.equal(lockName(scripts.watch), 'watch', `${name} watch`)
    assert.ok(scripts.compile.includes(BUILD), `${name} compile`)
    assert.ok(scripts.watch.includes(`${BUILD} --watch`), `${name} watch`)

    for (const [script, command] of Object.entries(scripts)) {
      if (!command.includes(BUILD)) continue

      // A second build command after the lock ends would run outside it.
      assert.ok(
        command.startsWith(LOCK_PREFIX) && command.endsWith('"'),
        `${name} ${script} builds outside the lock: ${command}`
      )
    }
  }
})

test('a publish builds through the compile script, never through a build of its own', () => {
  for (const name of declarationPackages()) {
    const scripts = readJson('programs', name, 'package.json').scripts

    for (const hook of ['prepublishOnly', 'prepack', 'prepare']) {
      const command = scripts[hook]

      if (!command) continue

      assert.equal(command.includes(BUILD), false, `${name} ${hook}`)
      assert.ok(
        command.split('&&')[0].trim() === 'pnpm run compile',
        `${name} ${hook} does not start with the compile script: ${command}`
      )
    }
  }

  for (const name of ['develop', 'extension']) {
    assert.ok(readJson('programs', name, 'package.json').scripts.prepublishOnly)
  }
})

test('no workflow and no root script builds a package around its compile script', () => {
  const files = [
    ...filesUnder(path.join(root, '.github', 'workflows'), ['.yml', '.yaml']),
    ...filesUnder(path.join(root, 'scripts'), ['.mjs', '.cjs', '.sh'])
  ]

  assert.ok(files.length > 20)

  for (const file of files) {
    assert.equal(
      fs.readFileSync(file, 'utf8').includes(BUILD),
      false,
      `${path.relative(root, file)} runs "${BUILD}" directly`
    )
  }

  for (const [script, command] of Object.entries(
    readJson('package.json').scripts
  )) {
    assert.equal(command.includes(BUILD), false, `root ${script}`)
  }
})

test('the release workflow compiles each published package by its compile script', () => {
  const release = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'publish-release.yml'),
    'utf8'
  )

  for (const name of declarationPackages()) {
    const packageName = readJson('programs', name, 'package.json').name

    assert.ok(
      release.includes(`pnpm --filter ${packageName} compile`),
      packageName
    )
  }
})

test('every typed export with a development target points it at source', () => {
  for (const name of declarationPackages()) {
    const manifest = readJson('programs', name, 'package.json')

    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      if (typeof entry !== 'object' || !('development' in entry)) continue

      assert.ok(
        entry.development.endsWith('.ts') &&
          !entry.development.includes('dist') &&
          fs.existsSync(path.join(root, 'programs', name, entry.development)),
        `${manifest.name} exports["${subpath}"].development is ${entry.development}`
      )

      assert.equal(Object.keys(entry)[0], 'development')
    }
  }

  // These three are imported by a sibling, so the typecheck resolves them.
  for (const name of ['create', 'develop', 'install']) {
    const entry = readJson('programs', name, 'package.json').exports['.']

    assert.equal(typeof entry.development, 'string', name)
  }
})

test('ci checks the emitted declarations in the job that compiles all four packages', () => {
  const ci = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    'utf8'
  )
  const start = ci.indexOf('\n  smoke-npx:\n')
  const end = ci.indexOf('\n  bundled-extensions:\n')

  assert.ok(start !== -1 && end > start)

  const job = ci.slice(start, end)
  const smoke = job.indexOf('run: pnpm smoke:npx')
  const check = job.indexOf('run: node scripts/check-emitted-types.mjs')

  assert.ok(smoke !== -1 && check > smoke)
  assert.equal(ci.split('check-emitted-types.mjs').length - 1, 1)

  const smokeScript = fs.readFileSync(
    path.join(root, 'scripts', 'smoke-npx.mjs'),
    'utf8'
  )

  for (const name of declarationPackages()) {
    assert.ok(smokeScript.includes(`'programs/${name}'`), name)
  }
})
