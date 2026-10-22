import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

export const HOOKS_PATH = '.githooks'
export const DISPATCH_DIR = 'extension-js-hooks'

export const CLIENT_HOOKS = [
  'applypatch-msg',
  'commit-msg',
  'post-checkout',
  'post-commit',
  'post-merge',
  'post-rewrite',
  'pre-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'pre-push',
  'pre-rebase',
  'prepare-commit-msg'
]

const DISPATCH_STUB = `#!/usr/bin/env sh
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
name=$(basename "$0")

if [ -x "$top/.githooks/$name" ]; then
  exec "$top/.githooks/$name" "$@"
fi

if [ -f "$top/.husky/_/$name" ]; then
  exec sh "$top/.husky/_/$name" "$@"
fi

exit 0
`

function git(args, cwd, env) {
  return spawnSync('git', args, {cwd, env, encoding: 'utf8'})
}

function toGitPath(file) {
  return file.split(path.sep).join('/')
}

export function installGitHooks({env = process.env, cwd = process.cwd()} = {}) {
  if (env.HUSKY === '0') {
    return {installed: false, reason: 'disabled'}
  }

  const inside = git(['rev-parse', '--is-inside-work-tree'], cwd, env)

  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    return {installed: false, reason: 'not-a-work-tree'}
  }

  const top = git(['rev-parse', '--show-toplevel'], cwd, env).stdout.trim()

  if (!top || !fs.existsSync(path.join(top, HOOKS_PATH))) {
    return {installed: false, reason: 'no-hooks-dir'}
  }

  const common = git(['rev-parse', '--git-common-dir'], top, env).stdout.trim()

  if (!common) {
    return {installed: false, reason: 'config-failed'}
  }

  const dispatchDir = path.resolve(top, common, DISPATCH_DIR)
  const names = new Set(CLIENT_HOOKS)

  for (const entry of fs.readdirSync(path.join(top, HOOKS_PATH))) {
    if (entry !== 'h') names.add(entry)
  }

  fs.mkdirSync(dispatchDir, {recursive: true})

  for (const name of names) {
    const stub = path.join(dispatchDir, name)
    fs.writeFileSync(stub, DISPATCH_STUB)
    fs.chmodSync(stub, 0o755)
  }

  const result = git(
    ['config', 'core.hooksPath', toGitPath(dispatchDir)],
    top,
    env
  )

  if (result.status !== 0) {
    return {installed: false, reason: 'config-failed'}
  }

  return {installed: true, hooksPath: toGitPath(dispatchDir)}
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const result = installGitHooks()

  if (!result.installed && result.reason === 'config-failed') {
    console.warn(
      `git hooks were not installed: could not set core.hooksPath to the ${DISPATCH_DIR} folder`
    )
  }
}
