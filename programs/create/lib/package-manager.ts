//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {execFileSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {getPackageManagerSpec} from 'prefers-yarn'

export {getPackageManagerSpec as getPackageManagerSpecFromEnv} from 'prefers-yarn'

const NODE_PACKAGE_MANAGERS = ['pnpm', 'yarn', 'bun', 'npm'] as const

type NodePackageManager = (typeof NODE_PACKAGE_MANAGERS)[number]

/* @invariant Only the manager that INVOKED this process may answer here. An
 * installed binary, a PATH entry, or an installer variable such as BUN_INSTALL
 * says what the machine has, never what the person typed, and recommending the
 * wrong second step is worse than recommending the default one. */
export function detectPackageManagerFromEnv(): NodePackageManager {
  const userAgent = (process.env.npm_config_user_agent || '').toLowerCase()
  for (const manager of NODE_PACKAGE_MANAGERS) {
    if (userAgent.includes(`${manager}/`)) return manager
  }

  const execPath = (
    process.env.npm_execpath ||
    process.env.NPM_EXEC_PATH ||
    ''
  ).toLowerCase()
  for (const manager of NODE_PACKAGE_MANAGERS) {
    if (execPath.includes(manager)) return manager
  }

  return 'npm'
}

// Deno sets neither npm_config_user_agent nor npm_execpath, so detection would
// fall through to npm; detect Deno via its runtime globals instead.
export function isDenoRuntime(): boolean {
  return (
    typeof (globalThis as {Deno?: unknown}).Deno !== 'undefined' ||
    Boolean((process as {versions?: {deno?: string}}).versions?.deno)
  )
}

// The package managers a scaffold can be created with; deno is folded in here
// so callers have a single closed set to switch on.
export type ScaffoldPackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'deno'

// Single source of truth for a scaffold's package manager: Deno runtime first,
// then the pm that invoked this process (a new project's lockfile comes from it).
export function resolveScaffoldPackageManager(): ScaffoldPackageManager {
  if (isDenoRuntime()) {
    return 'deno'
  }

  return detectPackageManagerFromEnv()
}

// The one answer to "which manager does this project use", read once after
// the template lands and threaded to every consumer: the declaration, the
// install, the printed next steps and the value handed back. A starter that
// pins a manager (a packageManager field, or the pnpm workspace file it
// ships) is that manager's project; anything else is the manager that ran
// this process, Deno first.
export function resolveProjectPackageManager(
  projectPath: string
): ScaffoldPackageManager {
  if (isDenoRuntime()) return 'deno'
  const pinned = readPinnedPackageManager(projectPath)
  if (pinned) return pinned
  if (fs.existsSync(path.join(projectPath, 'pnpm-workspace.yaml'))) {
    return 'pnpm'
  }
  return detectPackageManagerFromEnv()
}

export function readPinnedPackageManager(
  projectPath: string
): NodePackageManager | undefined {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    const pin = String(JSON.parse(raw)?.packageManager || '')
    const name = pin.split('@')[0].toLowerCase()
    return (NODE_PACKAGE_MANAGERS as readonly string[]).includes(name)
      ? (name as NodePackageManager)
      : undefined
  } catch {
    return undefined
  }
}

// The `name@version` the project declares for that manager: the template's
// own pin, else the invoking manager's spec when it is the same manager,
// else the installed binary's version. A host with no user agent still gets
// a usable declaration this way instead of an empty field.
export function resolvePackageManagerSpec(
  projectPath: string,
  manager: ScaffoldPackageManager
): string | undefined {
  if (manager === 'deno') return undefined
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    const pin = String(JSON.parse(raw)?.packageManager || '')
    if (pin.toLowerCase().startsWith(`${manager}@`)) return pin
  } catch {
    // No template pin to keep.
  }
  const fromEnv = getPackageManagerSpec()
  if (fromEnv && fromEnv.startsWith(`${manager}@`)) return fromEnv
  try {
    const version = execFileSync(manager, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    })
      .trim()
      .replace(/^v/, '')
    if (/^\d+\.\d+\.\d+/.test(version)) return `${manager}@${version}`
  } catch {
    // The manager is not on PATH; nothing usable to declare.
  }
  return undefined
}
