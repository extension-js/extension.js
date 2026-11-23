import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const PACKAGE_ROOT = path.resolve(__dirname, '..')
const HAS_DIST = fs.existsSync(path.join(PACKAGE_ROOT, 'dist', 'cli.cjs'))

// The file list npm would publish, read from a dry run that packs nothing and
// asks no registry. One run serves both tests. npm prints an array before
// version 11 and a map after.
let listed: string[] | undefined

function packedFiles(): string[] {
  if (listed) return listed

  const run = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'],
    {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: {...process.env, npm_config_update_notifier: 'false'},
      // npm is npm.cmd on Windows, which Node only starts through a shell.
      shell: process.platform === 'win32'
    }
  )

  expect(run.status, run.stderr || String(run.error)).toBe(0)

  const report = JSON.parse(run.stdout) as
    | Array<{files: Array<{path: string}>}>
    | Record<string, {files: Array<{path: string}>}>

  listed = Object.values(report)[0].files.map((file) => file.path)

  return listed
}

if (!HAS_DIST) {
  console.warn(
    '[published-files] programs/extension/dist does not exist, so the pack ' +
      'checks are skipped. Run `pnpm -C programs/extension compile` to run them.'
  )
}

// The declaration pass emits a file for everything in the tsconfig program,
// so a missing exclude ships build config and spec helpers to every user.
describe.skipIf(!HAS_DIST)('the published extension package', () => {
  it('packs no config declaration, spec file or source', () => {
    const files = packedFiles()
    const leaks = files.filter(
      (file) =>
        /\.config\.d\.[cm]?ts$/.test(file) ||
        file.split('/').includes('__spec__') ||
        file.includes('.spec.') ||
        (/\.[cm]?tsx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file))
    )

    expect(files).toContain('dist/cli.cjs')
    expect(leaks).toEqual([])
    // This row pays for the one pack: 2 to 11 s on a hosted Windows
    // runner, and 79 s once on a stalled one, where it still succeeded.
  }, 180000)

  it('packs no copy of the engine, which ships as its own package', () => {
    expect(
      packedFiles().filter((file) => file.startsWith('dist/develop/'))
    ).toEqual([])
  }, 60000)

  it('ships every file its exports, main, types and bin name', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
    ) as {
      main: string
      types: string
      bin: Record<string, string>
      exports: Record<string, Record<string, string>>
    }
    const named = Object.values(manifest.exports).flatMap((entry) =>
      Object.values(entry)
    )
    const targets = [
      ...new Set([
        manifest.main,
        manifest.types,
        ...Object.values(manifest.bin),
        ...named
      ])
    ]
    const files = packedFiles()

    expect(targets).toContain('./bin/extension.cjs')
    expect(
      targets.filter((target) => !files.includes(target.replace(/^\.\//, '')))
    ).toEqual([])
  }, 60000)
})
