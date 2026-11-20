import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

const PACKAGE_ROOT = path.resolve(__dirname, '..')
const HAS_DIST = fs.existsSync(path.join(PACKAGE_ROOT, 'dist'))

// The file list npm would publish, read from a dry run that packs nothing and
// asks no registry. npm prints an array before version 11 and a map after.
function packedFiles(): string[] {
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

  return Object.values(report)[0].files.map((file) => file.path)
}

if (!HAS_DIST) {
  console.warn(
    '[published-files] programs/install/dist does not exist, so the pack ' +
      'checks are skipped. Run `pnpm -C programs/install compile` to run them.'
  )
}

// The declaration pass emits a file for everything in the tsconfig program,
// so a missing exclude ships build config and spec helpers to every user.
describe.skipIf(!HAS_DIST)('the published extension-install package', () => {
  it('packs no config declaration, spec file or source', () => {
    const files = packedFiles()
    const leaks = files.filter(
      (file) =>
        /\.config\.d\.[cm]?ts$/.test(file) ||
        file.split('/').includes('__spec__') ||
        file.includes('.spec.') ||
        (/\.[cm]?tsx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file))
    )

    expect(files).toContain('dist/module.cjs')
    expect(leaks).toEqual([])
  }, 60000)

  it('ships every file its exports, main and types name', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
    ) as {
      main: string
      types: string
      exports: Record<string, Record<string, string>>
    }
    const named = Object.values(manifest.exports).flatMap((entry) =>
      Object.values(entry)
    )
    const targets = [...new Set([manifest.main, manifest.types, ...named])]
    const files = packedFiles()

    expect(targets).toContain('./dist/module.d.ts')
    expect(
      targets.filter((target) => !files.includes(target.replace(/^\.\//, '')))
    ).toEqual([])
  }, 60000)
})
