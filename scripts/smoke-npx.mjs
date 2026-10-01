// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

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

// All four workspace packages are packed together: pnpm pack rewrites the
// CLI's workspace:* specifiers to concrete versions (npm pack does not and
// produces an uninstallable tarball), and installing the sibling tarballs as
// top-level file: deps satisfies those requirements without falling back to
// the registry's published versions. Every package is compiled first so the
// smoke exercises this checkout; --fast packs the dist already there and
// names each reused one with its build time.
export const workspacePackages = [
  'programs/extension',
  'programs/create',
  'programs/develop',
  'programs/install'
]

export function parseSmokeOptions(argv) {
  const options = {fast: false}

  for (const arg of argv) {
    if (arg === '--fast') {
      options.fast = true
    } else {
      throw new Error(`Unknown option ${arg}. The only option is --fast.`)
    }
  }

  return options
}

export function newestMtime(dir) {
  let newest = null

  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name)
    const candidate = entry.isDirectory()
      ? newestMtime(full)
      : entry.isFile()
        ? statSync(full).mtime
        : null

    if (candidate && (!newest || candidate > newest)) newest = candidate
  }

  return newest
}

export function describeReusedDist(packageName, distDir, builtAt) {
  const when = builtAt ? builtAt.toISOString() : 'an empty dist'

  return `--fast: reusing the existing dist for ${packageName} at ${distDir} (built ${when}), not the source in this checkout`
}

function main() {
  const {fast} = parseSmokeOptions(process.argv.slice(2))
  const root = resolve(process.cwd())
  const cliDir = resolve(root, 'programs/extension')
  // Only the `javascript` template ships inside the extension-create tarball;
  // it is the one template guaranteed buildable without any network fetch.
  const templateJavascript = resolve(
    root,
    'programs/create/templates/javascript'
  )

  const compileOrder = [
    'programs/develop',
    'programs/create',
    'programs/install',
    'programs/extension'
  ]

  if (fast) {
    console.log('Compiling CLI...')
    run('pnpm', ['-C', cliDir, 'run', 'compile'])
  } else {
    for (const pkgRel of compileOrder) {
      console.log(`Compiling ${pkgRel}...`)
      run('pnpm', ['-C', resolve(root, pkgRel), 'run', 'compile'])
    }

    console.log(
      'Rebuilding the bundled extensions into programs/develop/dist...'
    )

    run(process.execPath, [resolve(root, 'scripts/build-extensions.cjs')], {
      cwd: root
    })
  }

  console.log('Packing workspace tarballs...')
  const packDest = mkdtempSync(join(tmpdir(), 'extjs-smoke-tarballs-'))
  const tarballs = []

  for (const pkgRel of workspacePackages) {
    const pkgDir = resolve(root, pkgRel)
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    const distDir = join(pkgDir, 'dist')

    if (fast && pkgRel !== 'programs/extension') {
      if (existsSync(distDir)) {
        console.log(describeReusedDist(pkg.name, distDir, newestMtime(distDir)))
      } else {
        console.log(`compiling ${pkg.name} (no dist found)...`)
        run('pnpm', ['-C', pkgDir, 'run', 'compile'])
      }
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
        EXTENSION_DEBUG: '1'
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
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
}
