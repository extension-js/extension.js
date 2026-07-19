//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// Package-manager detection is provided by the standalone `prefers-yarn`
// package (extracted from this logic). Re-exported here under the names the
// create steps already import.
import {detectPackageManagerFromEnv} from 'prefers-yarn'

export {
  detectPackageManagerFromEnv,
  getPackageManagerSpec as getPackageManagerSpecFromEnv
} from 'prefers-yarn'

// `prefers-yarn` only knows npm/yarn/pnpm/bun. When the CLI is launched through
// Deno (`deno run -A npm:extension ...`), Deno sets neither `npm_config_user_agent`
// nor `npm_execpath`, so detection falls through to the `npm` default and we would
// print `npm install` / `npm run dev` next steps. Detect Deno directly via its
// runtime globals so scaffolds can suggest `deno install` / `deno task dev` instead.
export function isDenoRuntime(): boolean {
  return (
    typeof (globalThis as {Deno?: unknown}).Deno !== 'undefined' ||
    Boolean((process as {versions?: {deno?: string}}).versions?.deno)
  )
}

// The package managers a scaffold can be created with. `deno` is not one of
// `prefers-yarn`'s names (it only knows the npm-family) — we detect it via the
// runtime and fold it in here so callers have a single closed set to switch on.
export type ScaffoldPackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'deno'

// Single source of truth for which package manager a scaffold uses, so the
// dependency install, the printed next-steps, and the `packageManager` field on
// `CreateResult` never disagree.
//
// Selection order:
//   1. Deno runtime (`deno run -A npm:extension ...`) → `deno`.
//   2. The package manager that invoked this process, read from the environment
//      (`npm_config_user_agent` / `npm_execpath`) via `prefers-yarn`, defaulting
//      to `npm`.
//
// This matches the convention used by `create-*` scaffolders: install with — and
// print next steps for — the package manager the user actually ran `extension
// create` through, rather than one sniffed from an ambient workspace. (Preferring
// a surrounding workspace's pm is a deliberate non-goal here: a scaffold is a new
// project, and its own lockfile should come from the tool the user invoked.)
export function resolveScaffoldPackageManager(): ScaffoldPackageManager {
  if (isDenoRuntime()) {
    return 'deno'
  }

  return detectPackageManagerFromEnv()
}
