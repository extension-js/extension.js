// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Stats} from '@rspack/core'
import {removeStagingDir} from '../lib/atomic-dist'
import {getBuildSummary} from '../lib/build-summary'
import {
  compilationDiagnostics,
  warningCodes
} from '../lib/compilation-diagnostics'
import * as messages from '../lib/messages'
import {CODES} from '../lib/messaging'
import type {NormalizedBrowser} from '../lib/paths'
import {reportedBuildFailures} from './build-failure'

// Prints the compile errors and their count, and answers with the failure a
// caller reads. The warnings are the ones a green build would have listed.
export function reportFailedCompile(input: {
  stats: Stats
  stagingDistPath: string
  packageJsonDir: string
  browser: NormalizedBrowser
  handleStatsErrors: (stats: Stats) => void
}): {failure: Error; failureWarnings: string[] | undefined} {
  const {stats, stagingDistPath, packageJsonDir, browser, handleStatsErrors} =
    input
  let failureWarnings: string[] | undefined

  // A failed compile keeps the last-good dist: nothing was written to
  // dist/<browser>, only the staging dir, which is discarded here.
  removeStagingDir(stagingDistPath)
  handleStatsErrors(stats)

  let errorCount = 1

  try {
    const info = stats.toJson({all: false, errors: true})
    errorCount = Math.max(1, info?.errors?.length || 1)
  } catch {
    // Ignore
  }

  console.error(messages.buildFailed(errorCount))

  const {details, truncated} = compilationDiagnostics(
    stats.compilation,
    packageJsonDir
  )

  try {
    failureWarnings =
      getBuildSummary(
        browser,
        stats.toJson({all: false, warnings: true}),
        undefined,
        undefined,
        warningCodes(stats.compilation)
      ).warnings || []
  } catch {
    // Ignore
  }

  const failure = Object.assign(new Error('Build failed with errors'), {
    code: CODES.E_COMPILE,
    diagnostics: details,
    truncated
  })
  reportedBuildFailures.add(failure)

  return {failure, failureWarnings}
}
