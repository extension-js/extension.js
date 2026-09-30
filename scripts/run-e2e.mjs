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

const args = process.argv.slice(2)
const projects = []
const passthrough = []

for (let index = 0; index < args.length; index++) {
  const arg = args[index]

  if (arg === '--project') {
    projects.push(args[++index])
    continue
  }

  if (arg.startsWith('--project=')) {
    projects.push(arg.slice('--project='.length))
    continue
  }

  passthrough.push(arg)
}

const wantsChromium = projects.length === 0 || projects.includes('chromium')
const wantsFirefox = projects.length === 0 || projects.includes('firefox')

// A grep or a spec path can leave one of the two runs below with no test at
// all, which Playwright reports as a failure. Only a filtered run gets to pass
// on an empty project, an unfiltered one still fails when nothing was found.
const filtered = passthrough.some(
  (arg) =>
    /^(-g|--grep|--grep-invert)(=|$)/.test(arg) ||
    /\.(spec|test)\.[cm]?[jt]s$/.test(arg) ||
    arg.includes('/')
)

if (filtered && wantsChromium && wantsFirefox) {
  passthrough.push('--pass-with-no-tests')
}

function playwright(project, extraEnv = {}) {
  const run = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', `--project=${project}`, ...passthrough],
    {
      cwd: root,
      stdio: 'inherit',
      env: {...env, ...extraEnv},
      shell: process.platform === 'win32'
    }
  )

  if (run.error) console.error(run.error.message)

  return run.status ?? 1
}

// The Firefox specs read dist/firefox of every content and new tab template
// when the worker loads them and fail on any that is missing. Building before
// the whole run is not enough: the chromium dev spec wipes dist/firefox on
// every template it visits. So chromium runs first, then the Firefox builds,
// then the firefox project.
function prebuildFirefox() {
  const {failed} = prebuildFirefoxTemplates()

  if (failed.length === 0) return 0

  console.error(
    `Firefox builds failed for ${failed.join(', ')}. Fix the build before running the Firefox specs.`
  )

  return 1
}

let status = 0

if (wantsChromium && wantsFirefox) {
  // Two runs, so each browser keeps its own html report under e2e-report/.
  const chromiumStatus = playwright('chromium', {
    PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(root, 'e2e-report', 'chromium')
  })

  const firefoxStatus =
    prebuildFirefox() ||
    playwright('firefox', {
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(root, 'e2e-report', 'firefox')
    })

  status = chromiumStatus || firefoxStatus
} else if (wantsFirefox) {
  status = prebuildFirefox() || playwright('firefox')
} else if (wantsChromium) {
  status = playwright('chromium')
} else {
  status = playwright(projects[0])
}

process.exit(status)
