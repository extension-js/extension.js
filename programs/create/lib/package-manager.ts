//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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
