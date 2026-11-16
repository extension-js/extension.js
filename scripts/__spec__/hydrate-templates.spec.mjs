import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const OWN_BUILD_SCRIPT = '// this repo builds with the CLI it compiled\n'

// A stand-in git that answers a clone with a small templates checkout holding
// a build script of its own, and a stand-in pnpm that installs nothing.
// Neither reaches the network, and git writes only into the new folder
// the clone names.
function runHydrate({withBuildScript}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrate-'))
  const bin = path.join(scratch, 'bin')
  const repo = path.join(scratch, 'repo')
  const calls = path.join(scratch, 'calls.log')

  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(repo, 'scripts'), {recursive: true})
  fs.copyFileSync(
    path.join(root, 'scripts', 'hydrate-templates-from-examples.sh'),
    path.join(repo, 'scripts', 'hydrate-templates-from-examples.sh')
  )

  if (withBuildScript) {
    fs.writeFileSync(
      path.join(repo, 'scripts', 'build-with-manifest.mjs'),
      OWN_BUILD_SCRIPT
    )
  }

  fs.writeFileSync(
    path.join(bin, 'git'),
    [
      '#!/usr/bin/env bash',
      `echo "git $*" >> "${calls}"`,
      'if [[ "$1" == "clone" ]]; then',
      '  for dest in "$@"; do :; done',
      '  [[ "$dest" == */examples && ! -e "$dest" ]] || exit 9',
      '  for name in typescript react svelte vue; do',
      '    mkdir -p "$dest/examples/$name/src"',
      '    echo "{}" > "$dest/examples/$name/src/manifest.json"',
      '    echo "{}" > "$dest/examples/$name/package.json"',
      '    echo "" > "$dest/examples/$name/template.spec.ts"',
      '  done',
      '  echo "" > "$dest/examples/extension-fixtures.ts"',
      '  echo "" > "$dest/examples/dirname.ts"',
      '  mkdir -p "$dest/scripts" "$dest/ci-scripts"',
      '  echo "// the templates repo copy" > "$dest/scripts/build-with-manifest.mjs"',
      '  echo "// the templates repo copy" > "$dest/ci-scripts/build-with-manifest.mjs"',
      '  exit 0',
      'fi',
      'if [[ "$*" == *"rev-parse HEAD"* ]]; then echo abc123; fi',
      ''
    ].join('\n'),
    {mode: 0o755}
  )

  fs.writeFileSync(
    path.join(bin, 'pnpm'),
    `#!/usr/bin/env bash\necho "pnpm $*" >> "${calls}"\n`,
    {mode: 0o755}
  )

  try {
    const result = spawnSync(
      'bash',
      [path.join(repo, 'scripts', 'hydrate-templates-from-examples.sh')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`
        }
      }
    )
    const buildScript = path.join(repo, 'scripts', 'build-with-manifest.mjs')

    return {
      ...result,
      calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '',
      buildScript: fs.existsSync(buildScript)
        ? fs.readFileSync(buildScript, 'utf8')
        : null,
      hydrated: fs.existsSync(
        path.join(repo, 'templates', 'react', 'src', 'manifest.json')
      )
    }
  } finally {
    fs.rmSync(scratch, {recursive: true, force: true})
  }
}

test('hydrate keeps this repo own build script and copies the templates', () => {
  const result = runHydrate({withBuildScript: true})

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.hydrated, true)
  assert.equal(result.buildScript, OWN_BUILD_SCRIPT)
  assert.match(result.stdout, /Pinned examples commit: abc123/)
})

test('hydrate stops before any fetch when the build script is missing', () => {
  const result = runHydrate({withBuildScript: false})

  assert.equal(result.status, 1)
  assert.match(result.stderr, /scripts\/build-with-manifest\.mjs is missing/)
  assert.equal(result.calls, '')
  assert.equal(result.hydrated, false)
  assert.equal(result.buildScript, null)
})

test('hydrate names no path the templates repo does not have', () => {
  const script = fs.readFileSync(
    path.join(root, 'scripts', 'hydrate-templates-from-examples.sh'),
    'utf8'
  )

  assert.doesNotMatch(script, /ci-scripts\//)
  assert.doesNotMatch(script, /2>\/dev\/null \|\| true/)
})
