// Package-manager detection is provided by the standalone `prefers-yarn`
// package (extracted from this logic). Re-exported here under the names the
// create steps already import.
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
