//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Package-manager detection comes from the standalone prefers-yarn package,
// re-exported under the names the create steps already import.
import {detectPackageManagerFromEnv} from 'prefers-yarn'

export {
  detectPackageManagerFromEnv,
  getPackageManagerSpec as getPackageManagerSpecFromEnv
} from 'prefers-yarn'

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
