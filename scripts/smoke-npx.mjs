import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {stdio: 'pipe', ...opts})
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
const cliDir = resolve(root, 'programs/cli')
const devDir = resolve(root, 'programs/develop')
const templatesReact = resolve(root, 'templates/react')

console.log('Compiling CLI and Develop...')
run('pnpm', ['-C', cliDir, 'run', 'compile'])
// Develop has prebuilt dist in repo; skip compile to avoid heavy native deps during smoke
// run('pnpm', ['-C', devDir, 'run', 'compile'])

console.log('Packing tarballs...')
const cliPack = run('npm', ['pack', '--silent'], {cwd: cliDir})
const cliTgz = cliPack.stdout.toString().trim()
const devPack = run('npm', ['pack', '--silent'], {cwd: devDir})
const devTgz = devPack.stdout.toString().trim()
console.log(`CLI tgz: ${cliTgz}`)
console.log(`DEV tgz: ${devTgz}`)

// Scenario A: install CLI only, ensure help works (no develop import)
{
  const tmp = mkdtempSync(join(tmpdir(), 'extjs-smoke-a-'))
  try {
    run('npm', ['init', '-y'], {cwd: tmp})
    run('npm', ['i', join(cliDir, cliTgz)], {cwd: tmp})
    const out = run('npx', ['extension', '--help'], {cwd: tmp}).stdout
    const text = out.toString()
    if (!/Usage:\s+extension\s+/i.test(text)) {
      throw new Error('Help output missing Usage: extension')
    }
    console.log('Scenario A ok: extension --help works with CLI tarball only')
  } finally {
    rmSync(tmp, {recursive: true, force: true})
  }
}

// Scenario B: install CLI + Develop and run a build
{
  const tmp = mkdtempSync(join(tmpdir(), 'extjs-smoke-b-'))
  try {
    run('npm', ['init', '-y'], {cwd: tmp})
    run('npm', ['i', join(cliDir, cliTgz), join(devDir, devTgz)], {cwd: tmp})
    const env = {
      ...process.env,
      EXTENSION_AUTHOR_MODE: '1'
    }
    run(
      'npx',
      [
        'extension',
        'build',
        templatesReact,
        '--browser=chromium',
        '--silent',
        'true'
      ],
      {cwd: tmp, env}
    )
    console.log('Scenario B ok: build runs with CLI + Develop tarballs')
  } finally {
    rmSync(tmp, {recursive: true, force: true})
  }
}

console.log('Smoke tests passed.')
