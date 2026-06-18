// Package-manager detection is provided by the standalone `prefers-yarn`
// package (extracted from this logic). Re-exported here under the names the
// create steps already import.
export {
  detectPackageManagerFromEnv,
  getPackageManagerSpec as getPackageManagerSpecFromEnv
} from 'prefers-yarn'
