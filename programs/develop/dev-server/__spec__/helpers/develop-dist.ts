import * as fs from 'node:fs'
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
