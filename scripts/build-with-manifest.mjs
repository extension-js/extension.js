#!/usr/bin/env node

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

const CWD = process.cwd()
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

// Some environments may not allow writing to the user's home directory.
// The Extension.js CLI writes telemetry under $XDG_CONFIG_HOME (or ~/.config),
// so default it to a repo-local folder to keep builds reliable.
const XDG_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME || path.join(REPO_ROOT, '.xdg-config')

try {
  fs.mkdirSync(XDG_CONFIG_HOME, {recursive: true})
} catch {
  /* noop */
}

function run(command, args, opts = {}) {
  const r = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...opts
  })

  if (r.error) throw r.error
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function main() {
  const mode = process.argv[2] || 'build' // build | dev | preview
  const extraArgs = process.argv.slice(3)

  // No manifest rewriting.
  // Extension.js resolves manifest.json recursively (e.g. src/manifest.json),
  // so this script must never create a temporary root manifest.json.
  const env = {...process.env, XDG_CONFIG_HOME}

  // Ensure the root workspace binary is available from any example dir.
  const binDir = path.join(REPO_ROOT, 'node_modules', '.bin')
  env.PATH = env.PATH ? `${binDir}${path.delimiter}${env.PATH}` : binDir

  if (process.env.EXTENSION_SKIP_INSTALL !== undefined) {
    env.EXTENSION_SKIP_INSTALL = process.env.EXTENSION_SKIP_INSTALL
  }

  /* @invariant The e2e templates must build with the CLI this checkout just
     compiled, never with whatever `extension` happens to be on PATH. The root
     package.json carries no dependency on the `extension` workspace package,
     so pnpm writes no node_modules/.bin/extension: a bare spawn is ENOENT on a
     CI runner and silently picks up a stale global install on a developer
     machine. Spawn the workspace bin directly and keep the PATH lookup only as
     a fallback for a checkout where programs/ is absent. */
  const workspaceBin = path.join(
    REPO_ROOT,
    'programs',
    'extension',
    'bin',
    'extension.cjs'
  )

  if (fs.existsSync(workspaceBin)) {
    run(process.execPath, [workspaceBin, mode, ...extraArgs], {
      cwd: CWD,
      env
    })
    return
  }

  run('extension', [mode, ...extraArgs], {
    cwd: CWD,
    env
  })
}

main()
