// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {after, test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  checkPackedExports,
  listPublishablePackages,
  manifestTargets,
  missingTargets,
  packedFiles
} from '../check-packed-exports.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const script = path.join(root, 'scripts', 'check-packed-exports.mjs')
const fixtures = []

after(() => {
  for (const dir of fixtures) fs.rmSync(dir, {recursive: true, force: true})
})

function writePackage(manifest, files) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-packed-exports-'))
  )

  fixtures.push(dir)

  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true})
    fs.writeFileSync(path.join(dir, file), 'module.exports = {}\n')
  }

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({version: '1.0.0', files: ['dist'], ...manifest}, null, 2)
  )

  return dir
}

function runCheck(...dirs) {
  return spawnSync(process.execPath, [script, ...dirs], {encoding: 'utf8'})
}

test('every entry field and every condition is a target', () => {
  assert.deepEqual(
    manifestTargets({
      exports: {
        '.': {
          source: './module.ts',
          node: {import: './dist/a.mjs', require: './dist/a.cjs'},
          default: ['./dist/a.js', null]
        },
        './data/*': './dist/data/*',
        './gone': null
      },
      main: './dist/a.cjs',
      module: './dist/a.mjs',
      types: './dist/a.d.ts',
      bin: {tool: './bin/tool.js'}
    }),
    [
      {where: 'exports["."]["source"]', target: './module.ts'},
      {where: 'exports["."]["node"]["import"]', target: './dist/a.mjs'},
      {where: 'exports["."]["node"]["require"]', target: './dist/a.cjs'},
      {where: 'exports["."]["default"][0]', target: './dist/a.js'},
      {where: 'exports["./data/*"]', target: './dist/data/*'},
      {where: 'main', target: './dist/a.cjs'},
      {where: 'module', target: './dist/a.mjs'},
      {where: 'types', target: './dist/a.d.ts'},
      {where: 'bin["tool"]', target: './bin/tool.js'}
    ]
  )

  assert.deepEqual(manifestTargets({exports: './a.js', bin: 'cli.js'}), [
    {where: 'exports', target: './a.js'},
    {where: 'bin', target: 'cli.js'}
  ])

  assert.deepEqual(manifestTargets({name: 'bare'}), [])
})

test('a target is missing when no packed file answers it', () => {
  const files = ['package.json', 'dist/a.js', 'dist/data/one.json']

  assert.deepEqual(
    missingTargets(
      {
        exports: {
          '.': {source: './module.ts', default: './dist/a.js'},
          './data/*': './dist/data/*',
          './none/*': './dist/none/*.json',
          './package.json': './package.json'
        },
        main: 'dist/a',
        types: './dist/a.d.ts',
        bin: 'dist/cli.js'
      },
      files
    ),
    [
      {where: 'exports["."]["source"]', target: './module.ts'},
      {where: 'exports["./none/*"]', target: './dist/none/*.json'},
      {where: 'types', target: './dist/a.d.ts'},
      {where: 'bin', target: 'dist/cli.js'}
    ]
  )
})

test('the check fails on a package that exports a file it does not pack', () => {
  const dir = writePackage(
    {
      name: 'fixture-dangling',
      exports: {
        '.': {development: './module.ts', default: './dist/module.cjs'}
      },
      main: './dist/module.cjs'
    },
    ['module.ts', 'dist/module.cjs']
  )

  // The source file is on disk and "files" keeps it out of the tarball.
  assert.ok(!packedFiles(dir).includes('module.ts'))

  const result = runCheck(dir)

  assert.equal(result.status, 1, result.stderr)
  assert.match(
    result.stderr,
    /fixture-dangling: exports\["\."\]\["development"\] names \.\/module\.ts/
  )

  assert.doesNotMatch(result.stderr, /dist\/module\.cjs/)
})

test('the check passes once every entry is packed, and names what it read', () => {
  const dir = writePackage(
    {
      name: 'fixture-sound',
      exports: {'.': {default: './dist/module.cjs'}},
      main: './dist/module.cjs',
      bin: './dist/cli.cjs'
    },
    ['module.ts', 'dist/module.cjs', 'dist/cli.cjs']
  )
  const result = runCheck(dir)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /3 targets in fixture-sound\./)
})

test('one dangling package fails a run that also holds a sound one', () => {
  const sound = writePackage({name: 'fixture-a', main: './dist/a.js'}, [
    'dist/a.js'
  ])
  const dangling = writePackage(
    {name: 'fixture-b', main: './dist/a.js', types: './dist/a.d.ts'},
    ['dist/a.js']
  )
  const result = checkPackedExports({dirs: [sound, dangling]})

  assert.equal(result.ok, false)
  assert.deepEqual(result.problems, ['fixture-b: types names ./dist/a.d.ts'])
})

test('the workspace list is the four published packages', () => {
  assert.deepEqual(
    listPublishablePackages(root).map(({manifest}) => manifest.name),
    ['extension', 'extension-create', 'extension-develop', 'extension-install']
  )
})

test('no manifest of ours names a source file', () => {
  for (const {manifest} of listPublishablePackages(root)) {
    const source = manifestTargets(manifest).filter(
      ({target}) => /\.[cm]?tsx?$/.test(target) && !/\.d\.[cm]?ts$/.test(target)
    )

    assert.deepEqual(source, [], manifest.name)
  }
})

test('both release paths run the check after the packages are built', () => {
  const read = (name) =>
    fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8')
  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).scripts
  const release = read('publish-release.yml')
  const ci = read('ci.yml')

  assert.equal(
    scripts['check:packed-exports'],
    'node scripts/check-packed-exports.mjs'
  )

  const built = release.indexOf('- name: Build packages')
  const checked = release.indexOf('run: pnpm check:packed-exports')
  const published = release.indexOf('- name: Publish extension-create')

  assert.ok(built !== -1 && built < checked && checked < published)
  assert.ok(
    ci.indexOf('run: pnpm smoke:npx') <
      ci.indexOf('run: pnpm check:packed-exports')
  )
})
