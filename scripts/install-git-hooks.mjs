import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

export const HOOKS_PATH = '.githooks'

function git(args, cwd) {
  return spawnSync('git', args, {cwd, encoding: 'utf8'})
}

export function installGitHooks({env = process.env, cwd = process.cwd()} = {}) {
  if (env.HUSKY === '0') {
    return {installed: false, reason: 'disabled'}
  }

  const inside = git(['rev-parse', '--is-inside-work-tree'], cwd)

  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    return {installed: false, reason: 'not-a-work-tree'}
  }

  const result = git(['config', 'core.hooksPath', HOOKS_PATH], cwd)

  if (result.status !== 0) {
    return {installed: false, reason: 'config-failed'}
  }

  return {installed: true}
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const result = installGitHooks()

  if (!result.installed && result.reason === 'config-failed') {
    console.warn(
      `git hooks were not installed: could not set core.hooksPath to ${HOOKS_PATH}`
    )
  }
}
