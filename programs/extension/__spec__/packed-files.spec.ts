import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const HAS_DIST = fs.existsSync(path.join(packageRoot, 'dist', 'cli.cjs'))

// What npm would publish, read from a dry run that packs nothing. npm prints
// an array before version 11 and a map after.
function packedFiles(): string[] {
  const run = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: {...process.env, npm_config_update_notifier: 'false'},
      // npm is npm.cmd on Windows, which Node only starts through a shell.
      shell: process.platform === 'win32'
    }
  )

  expect(run.status, run.stderr || String(run.error)).toBe(0)

  const report = JSON.parse(run.stdout) as Record<
    string,
    {files: Array<{path: string}>}
  >

  return Object.values(report)[0].files.map((file) => file.path)
}

describe.skipIf(!HAS_DIST)('the published extension package', () => {
  it('packs no config declaration, spec file or TypeScript source', () => {
    const files = packedFiles()
    const leaks = files.filter(
      (file) =>
        /\.config\.d\.[cm]?ts$/.test(file) ||
        file.split('/').includes('__spec__') ||
        file.includes('.spec.') ||
        (/\.[cm]?tsx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file))
    )

    expect(files).toContain('dist/cli.cjs')
    expect(files).toContain('bin/extension.cjs')
    expect(leaks).toEqual([])
  }, 120_000)

  it('packs no copy of the engine, which ships as its own package', () => {
    const files = packedFiles()

    expect(files.filter((file) => file.startsWith('dist/develop/'))).toEqual([])
  }, 120_000)
})
