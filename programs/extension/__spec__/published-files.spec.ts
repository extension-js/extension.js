import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

const PACKAGE_ROOT = path.resolve(__dirname, '..')
const HAS_DIST = fs.existsSync(path.join(PACKAGE_ROOT, 'dist', 'cli.cjs'))

const makeTemp = trackTempFolders()

// What npm always packs from the package root, whatever "files" says.
const ALWAYS_PACKED = /^(package\.json|readme(\..*)?|licen[cs]e(\..*)?)$/i

// The package without node_modules: packing in place made npm read the
// installed dependency tree too, 2 to 3 s on Windows against 0.9 s here.
function packageCopy(): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
  ) as {
    files: string[]
    bundleDependencies?: unknown
    bundledDependencies?: unknown
  }
  const named = manifest.files.filter((entry) => !entry.startsWith('!'))

  // The copy would hide either one: a pattern is not a path to copy, and
  // bundled dependencies are packed from node_modules.
  expect(named.filter((entry) => /[*?[\]{}]/.test(entry))).toEqual([])
  expect(manifest.bundleDependencies ?? manifest.bundledDependencies).toBe(
    undefined
  )

  const copy = makeTemp('extjs-published-files-')
  const rootFiles = fs
    .readdirSync(PACKAGE_ROOT, {withFileTypes: true})
    .filter((entry) => entry.isFile() && ALWAYS_PACKED.test(entry.name))
    .map((entry) => entry.name)

  for (const entry of [...rootFiles, '.npmignore', ...named]) {
    const from = path.join(PACKAGE_ROOT, entry)

    if (fs.existsSync(from)) {
      fs.cpSync(from, path.join(copy, entry), {recursive: true})
    }
  }

  return copy
}

// The file list npm would publish, read from a dry run that packs nothing and
// asks no registry. One run serves every test. npm prints an array before
// version 11 and a map after.
let listed: string[] | undefined

function packedFiles(): string[] {
  if (listed) return listed

  const run = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'],
    {
      cwd: packageCopy(),
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
  }, 60000)

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
