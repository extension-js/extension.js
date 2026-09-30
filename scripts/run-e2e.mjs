// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {prebuildFirefoxTemplates} from './prebuild-firefox-templates.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatesDir = path.join(root, 'templates')
const cli = path.join(root, 'programs', 'extension', 'bin', 'extension.cjs')
const required = ['typescript', 'react', 'svelte', 'vue']

const hydrated =
  fs.existsSync(templatesDir) &&
  required.every((name) =>
    fs.existsSync(path.join(templatesDir, name, 'package.json'))
  )

if (!hydrated) {
  // The specs live in the examples repo and land here at run time, so an
  // un-hydrated checkout reported "No tests found" instead of what to do.
  console.error('The end-to-end specs are not in this checkout yet.')
  console.error('Run: bash scripts/hydrate-templates-from-examples.sh')
  process.exit(1)
}

// Eight cross-template specs resolve the CLI through this variable and
// otherwise shell out to `pnpm extension` from a tmpdir outside the workspace.
const env = {...process.env}
env.EXTENSION_LOCAL_CLI_CJS ||= cli

const version = spawnSync(process.execPath, [cli, '--version'], {
  encoding: 'utf-8'
})

if (version.status !== 0) {
  console.error('The compiled CLI does not answer. Run: pnpm compile')
  process.exit(1)
}

// The Firefox specs sweep dist/firefox of every content and new tab template
// and fail on any that is missing. Nothing else in the run builds those, so a
// run that includes the firefox project builds them here first.
const projects = process.argv
  .slice(2)
  .flatMap((arg, index, args) => {
    if (arg === '--project') return [args[index + 1]]
    if (arg.startsWith('--project=')) return [arg.slice('--project='.length)]

    return []
  })
  .filter(Boolean)

if (projects.length === 0 || projects.includes('firefox')) {
  const {failed} = prebuildFirefoxTemplates()

  if (failed.length > 0) {
    console.error(
      `Firefox builds failed for ${failed.join(', ')}. Fix the build before running the Firefox specs.`
    )

    process.exit(1)
  }
}

const run = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', ...process.argv.slice(2)],
  {cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32'}
)

if (run.error) console.error(run.error.message)

process.exit(run.status ?? 1)
