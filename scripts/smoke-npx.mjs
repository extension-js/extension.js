// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'

// Ensure spawned processes find node/npm/pnpm (cross-platform, e.g. Windows CI)
const nodeDir = dirname(process.execPath)
const pathDelim = process.platform === 'win32' ? ';' : ':'
const childEnv = {
  ...process.env,
  PATH: `${nodeDir}${pathDelim}${process.env.PATH || process.env.Path || ''}`
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'pipe',
    env: childEnv,
    ...opts
  })

  if (res.error) throw res.error

  if ((res.status || 0) !== 0) {
    const out = (res.stdout || Buffer.alloc(0)).toString()
    const err = (res.stderr || Buffer.alloc(0)).toString()
    throw new Error(
      `[${cmd} ${args.join(' ')}] failed with code ${res.status}\n${out}\n${err}`
    )
  }

  return res
}

const root = resolve(process.cwd())
const cliDir = resolve(root, 'programs/extension')
// Only the `javascript` template ships inside the extension-create tarball;
// it is the one template guaranteed buildable without any network fetch.
const templateJavascript = resolve(root, 'programs/create/templates/javascript')

// All four workspace packages are packed together: pnpm pack rewrites the
// CLI's workspace:* specifiers to concrete versions (npm pack does not and
// produces an uninstallable tarball), and installing the sibling tarballs as
// top-level file: deps satisfies those requirements without falling back to
// the registry's published versions, so the smoke exercises LOCAL code.
const workspacePackages = [
  'programs/extension',
  'programs/create',
  'programs/develop',
  'programs/install'
]

console.log('Compiling CLI...')
run('pnpm', ['-C', cliDir, 'run', 'compile'])

console.log('Packing workspace tarballs...')
const packDest = mkdtempSync(join(tmpdir(), 'extjs-smoke-tarballs-'))
const tarballs = []

for (const pkgRel of workspacePackages) {
  const pkgDir = resolve(root, pkgRel)
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

  // dist/ is gitignored, so fresh checkouts (CI) have no prebuilt output.
  // Local runs keep their existing dist to stay fast.
  if (pkgRel !== 'programs/extension' && !existsSync(join(pkgDir, 'dist'))) {
    console.log(`compiling ${pkg.name} (no dist found)...`)
    run('pnpm', ['-C', pkgDir, 'run', 'compile'])
  }

  run('pnpm', ['--dir', pkgDir, 'pack', '--pack-destination', packDest])

  const tgz = join(packDest, `${pkg.name}-${pkg.version}.tgz`)
  if (!existsSync(tgz)) {
    throw new Error(`pnpm pack did not produce expected tarball: ${tgz}`)
  }
  tarballs.push(tgz)
  console.log(`packed: ${pkg.name}-${pkg.version}.tgz`)
}

function installTarballs(cwd) {
  run('npm', ['init', '-y'], {cwd})
  run('npm', ['i', '--no-audit', '--no-fund', ...tarballs], {cwd})
}

// Scenario A: install packed tarballs, ensure help works
{
  const tmp = mkdtempSync(join(tmpdir(), 'extjs-smoke-a-'))

  try {
    installTarballs(tmp)

    const out = run('npx', ['extension', '--help'], {cwd: tmp}).stdout
    const text = out.toString()

    if (!/Usage:\s+extension\s+/i.test(text)) {
      throw new Error('Help output missing Usage: extension')
    }

    console.log('Scenario A ok: extension --help works from packed tarballs')
  } finally {
    rmSync(tmp, {recursive: true, force: true})
  }
}

// Scenario B: build the bundled javascript template from packed tarballs
{
  const tmp = mkdtempSync(join(tmpdir(), 'extjs-smoke-b-'))

  try {
    const projectDir = join(tmp, 'project')
    cpSync(templateJavascript, projectDir, {recursive: true})

    installTarballs(tmp)

    const env = {
      ...childEnv,
      EXTENSION_AUTHOR_MODE: '1'
    }

    run(
      'npx',
      [
        'extension',
        'build',
        projectDir,
        '--browser=chromium',
        '--silent',
        'true'
      ],
      {cwd: tmp, env}
    )

    const distManifest = join(projectDir, 'dist', 'chromium', 'manifest.json')
    if (!existsSync(distManifest)) {
      throw new Error(`Build produced no dist manifest at ${distManifest}`)
    }

    console.log('Scenario B ok: build runs from packed tarballs')
  } finally {
    rmSync(tmp, {recursive: true, force: true})
  }
}

rmSync(packDest, {recursive: true, force: true})
console.log('Smoke tests passed.')
