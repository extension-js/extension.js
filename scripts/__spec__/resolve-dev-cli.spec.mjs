import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  cliSpawnArgs,
  describeDevCli,
  repoCliPath,
  resolveDevCli,
  resolveInstalledCli,
  resolveRepoCli
} from '../lib/resolve-dev-cli.mjs'

function tempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function writeInstalledPackage(projectDir, pkg, binFile = 'dist/cli.cjs') {
  const packageDir = path.join(projectDir, 'node_modules', 'extension')
  mkdirSync(path.join(packageDir, path.dirname(binFile)), {recursive: true})
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(pkg))
  writeFileSync(path.join(packageDir, binFile), '')

  return packageDir
}

test('resolveInstalledCli returns the bin the installed package declares', () => {
  const projectDir = tempDir('resolve-dev-cli-')

  try {
    const packageDir = writeInstalledPackage(projectDir, {
      name: 'extension',
      version: '9.9.9',
      bin: {extension: 'dist/cli.cjs'}
    })

    const cli = resolveInstalledCli(projectDir)
    assert.equal(cli.cliPath, path.join(packageDir, 'dist/cli.cjs'))
    assert.equal(cli.source, 'project node_modules (9.9.9)')
    assert.equal(
      describeDevCli(cli),
      `project node_modules (9.9.9) (${path.join(packageDir, 'dist/cli.cjs')})`
    )
  } finally {
    rmSync(projectDir, {recursive: true, force: true})
  }
})

test('resolveInstalledCli accepts a string bin field', () => {
  const projectDir = tempDir('resolve-dev-cli-')

  try {
    const packageDir = writeInstalledPackage(
      projectDir,
      {name: 'extension', version: '1.0.0', bin: 'cli.cjs'},
      'cli.cjs'
    )

    assert.equal(
      resolveInstalledCli(projectDir).cliPath,
      path.join(packageDir, 'cli.cjs')
    )
  } finally {
    rmSync(projectDir, {recursive: true, force: true})
  }
})

test('resolveInstalledCli refuses a project with no installed CLI', () => {
  const projectDir = tempDir('resolve-dev-cli-')

  try {
    assert.throws(
      () => resolveInstalledCli(projectDir),
      /no installed extension CLI at .*node_modules[\\/]extension/
    )
  } finally {
    rmSync(projectDir, {recursive: true, force: true})
  }
})

test('resolveInstalledCli refuses a package without a bin or with a missing bin file', () => {
  const projectDir = tempDir('resolve-dev-cli-')

  try {
    const packageDir = writeInstalledPackage(projectDir, {
      name: 'extension',
      version: '1.0.0'
    })
    assert.throws(() => resolveInstalledCli(projectDir), /declares no bin/)

    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({version: '1.0.0', bin: {extension: 'missing.cjs'}})
    )

    assert.throws(() => resolveInstalledCli(projectDir), /bin is missing/)
  } finally {
    rmSync(projectDir, {recursive: true, force: true})
  }
})

test('resolveRepoCli points at the compiled cli.cjs and refuses an unbuilt repo', () => {
  const root = tempDir('resolve-dev-cli-root-')

  try {
    assert.throws(() => resolveRepoCli(root), /not built at .*cli\.cjs/)

    const cliPath = repoCliPath(root)
    mkdirSync(path.dirname(cliPath), {recursive: true})
    writeFileSync(cliPath, '')

    assert.deepEqual(resolveRepoCli(root), {cliPath, source: 'repo build'})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('resolveDevCli picks the repo build only when asked to', () => {
  const root = tempDir('resolve-dev-cli-root-')
  const projectDir = tempDir('resolve-dev-cli-')

  try {
    const cliPath = repoCliPath(root)
    mkdirSync(path.dirname(cliPath), {recursive: true})
    writeFileSync(cliPath, '')
    const packageDir = writeInstalledPackage(projectDir, {
      version: '2.0.0',
      bin: {extension: 'dist/cli.cjs'}
    })

    assert.equal(
      resolveDevCli({projectDir, useRepoBuild: true, root}).cliPath,
      cliPath
    )

    assert.equal(
      resolveDevCli({projectDir, root}).cliPath,
      path.join(packageDir, 'dist/cli.cjs')
    )
  } finally {
    rmSync(root, {recursive: true, force: true})
    rmSync(projectDir, {recursive: true, force: true})
  }
})

test('cliSpawnArgs runs the resolved file with the current node and no shell', () => {
  const [command, args] = cliSpawnArgs(
    {cliPath: '/repo/cli.cjs', source: 'repo build'},
    ['dev', '--browser=chrome']
  )

  assert.equal(command, process.execPath)
  assert.deepEqual(args, ['/repo/cli.cjs', 'dev', '--browser=chrome'])
})
