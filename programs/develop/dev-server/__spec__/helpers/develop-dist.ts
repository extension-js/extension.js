import * as fs from 'node:fs'
import * as path from 'node:path'
import {resolveDevelopDistFile} from '../../../lib/develop-context'

export const DEVELOP_COMPILE_COMMAND = 'pnpm --filter extension-develop compile'

// The dev compile loads these loaders from the package's compiled dist, so
// without them every compile fails and the spec waits out its deadline.
const DIST_FILES_A_DEV_COMPILE_LOADS = [
  'ensure-hmr-for-scripts',
  'minimum-script-file',
  'feature-scripts-content-script-wrapper'
]

export function missingDevelopDist(): string | null {
  const missing = DIST_FILES_A_DEV_COMPILE_LOADS.filter(
    (stem) => !fs.existsSync(resolveDevelopDistFile(stem))
  )

  if (missing.length === 0) return null

  return `needs the compiled dist (${missing.join(', ')}): run ${DEVELOP_COMPILE_COMMAND}`
}

// For beforeEach: the test is skipped with the reason and the command shown.
export function skipWithoutDevelopDist(context: {
  skip: (note?: string) => void
}): void {
  const missing = missingDevelopDist()

  if (missing) context.skip(missing)
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|json)$/

// Every source the build reads, from the engine root down. The build output,
// installed packages, specs and dot folders are not sources.
function newestSourceTime(dir: string): number {
  let newest = 0

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue
    if (['__spec__', 'node_modules', 'dist'].includes(entry.name)) continue

    const file = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceTime(file))
    } else if (SOURCE_FILE.test(entry.name) && !/\.spec\./.test(entry.name)) {
      newest = Math.max(newest, fs.statSync(file).mtimeMs)
    }
  }

  return newest
}

// A spec that runs the built entry reads old engine code from a build older
// than the sources, and would pass or fail for what is no longer there.
export function staleDevelopDist(builtFile: string): string | null {
  if (!fs.existsSync(builtFile)) {
    return `needs the compiled dist: run ${DEVELOP_COMPILE_COMMAND}`
  }

  // The engine root is the folder that holds dist.
  const root = path.dirname(path.dirname(builtFile))

  return fs.statSync(builtFile).mtimeMs < newestSourceTime(root)
    ? `the compiled dist is older than the engine sources: run ${DEVELOP_COMPILE_COMMAND}`
    : null
}

// For beforeEach, beside skipWithoutDevelopDist.
export function skipWithStaleDevelopDist(
  context: {skip: (note?: string) => void},
  builtFile: string
): void {
  const stale = staleDevelopDist(builtFile)

  if (stale) context.skip(stale)
}
