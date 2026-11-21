// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type {Stats} from '@rspack/core'
import {
  buildNamesOversizeFiles,
  failedAddonLint,
  oversizeSingleFileLines,
  runAddonLint,
  summarizeAddonLint
} from '../lib/addon-lint'
import {promoteStagingDist} from '../lib/atomic-dist'
import {type BuildSummary, getBuildSummary} from '../lib/build-summary'
import {markBuildTold} from '../lib/build-told'
import {getBuildToolchain} from '../lib/build-toolchain'
import {collectChunkDependencyProvenance} from '../lib/chunk-dependency-provenance'
import {codedError} from '../lib/coded-error'
import {recordCodedWarning, takeCodedWarnings} from '../lib/coded-warnings'
import {warningCodes} from '../lib/compilation-diagnostics'
import {
  type findDuplicateOutputFiles,
  importedAssetSources
} from '../lib/duplicate-output-files'
import {findLoopbackOrigins} from '../lib/loopback-origins'
import * as messages from '../lib/messages'
import {CODES, humanLine, isDebug} from '../lib/messaging'
import type {listOutputFiles} from '../lib/output-files'
import {asAskedPath, displayPath, type NormalizedBrowser} from '../lib/paths'
import {
  buildSummaryPath,
  ensureSessionArtifactsIgnoreFile,
  ensureSessionStateInProjectGitignore
} from '../lib/session-paths'
import {stripAnsi} from '../lib/strip-ansi'
import {
  getZipArtifacts,
  getZipFailures
} from '../plugin-compilation/zip-artifacts'
import {stampReadyDistExtensionId} from '../plugin-ready-contract'
import {removeDevelopmentArtifacts} from '../plugin-reload/reload-lib/development-artifacts'
import type {BuildOptions} from '../types'
import type {createBuildReceipt} from './build-receipt'

// Projects whose toolchain sentence this process already printed.
const toolchainLinePrinted = new Set<string>()

// Specs build the same project more than once in one process.
export function resetBuildToolchainLine(): void {
  toolchainLinePrinted.clear()
}

// Reads the promoted manifest, so the warning names exactly what ships.
function warnProductionLoopbackOrigins(distPath: string, quiet: boolean): void {
  let manifest: unknown

  try {
    manifest = JSON.parse(
      fs.readFileSync(nodePath.join(distPath, 'manifest.json'), 'utf-8')
    )
  } catch {
    return
  }

  const origins = findLoopbackOrigins(manifest)
  if (origins.length === 0) return

  recordCodedWarning(
    CODES.W_PROD_LOOPBACK_ORIGIN,
    messages.productionLoopbackOriginsText(origins)
  )

  if (!quiet) console.warn(messages.productionLoopbackOrigins(origins))
}

// Everything a compile with no errors still owes: the output moved into
// place, the summary, the store check, the receipt and the closing lines.
// A requested archive that was not made comes back as the failure it is.
export async function finishGreenBuild(input: {
  stats: Stats
  summary: BuildSummary
  browser: NormalizedBrowser
  buildType: BuildSummary['buildType']
  resolvedMode: 'development' | 'production' | 'none'
  packageJsonDir: string
  distPath: string
  stagingDistPath: string
  displayDistPath: string
  useStagingSwap: boolean
  liveDevSession: unknown
  quiet: boolean
  outputFiles: ReturnType<typeof listOutputFiles>
  duplicateGroups: ReturnType<typeof findDuplicateOutputFiles>
  mergedBuildOptions: BuildOptions
  packagingFollows: boolean
  receipt: ReturnType<typeof createBuildReceipt>
  isEmitTimeWarning: typeof import('../lib/stats-handler').isEmitTimeWarning
}): Promise<{
  summary: BuildSummary
  zipFailure?: {count: number; error: Error}
}> {
  const {
    stats,
    browser,
    buildType,
    resolvedMode,
    packageJsonDir,
    distPath,
    stagingDistPath,
    displayDistPath,
    useStagingSwap,
    liveDevSession,
    quiet,
    outputFiles,
    duplicateGroups,
    mergedBuildOptions,
    packagingFollows,
    isEmitTimeWarning
  } = input
  const {heldReceipt, openReceipt, writeReadyWhenHeld} = input.receipt
  let summary = input.summary

  // Read before the output is published: a throw here fails the
  // build, and a failed build leaves the folder as it found it.
  // Anonymized aggregates (no filenames or paths)
  const info = stats?.toJson({
    all: false,
    assets: true,
    warnings: true,
    errors: true
  })

  // Publish the finished staging dir before any success receipt so a
  // green line is never printed over a half-populated dist.
  if (useStagingSwap && fs.existsSync(stagingDistPath)) {
    try {
      promoteStagingDist(stagingDistPath, distPath)
    } catch (promoteError) {
      throw Object.assign(
        codedError(
          CODES.E_DESTINATION_NOT_WRITABLE,
          messages.buildOutputNotPublished(displayPath(distPath), promoteError)
        ),
        {cause: promoteError}
      )
    }

    if (!liveDevSession) {
      stampReadyDistExtensionId(packageJsonDir, browser, distPath)
    }
  }

  let keptArtifactsLine = ''

  if (buildType === 'production') {
    const pruned = removeDevelopmentArtifacts(displayDistPath)

    if (pruned.kept.length > 0) {
      keptArtifactsLine = messages.developmentArtifactsKept(
        displayDistPath,
        pruned.kept
      )

      if (!quiet) console.warn(keptArtifactsLine)
    }

    warnProductionLoopbackOrigins(displayDistPath, quiet)
  }

  // The summary names the folder the artifacts landed in, which under
  // a re-pointed output.path is not dist/<browser>.
  summary = {
    ...summary,
    ...getBuildSummary(
      browser,
      info,
      asAskedPath(displayDistPath),
      outputFiles,
      warningCodes(stats.compilation),
      packageJsonDir
    ),
    toolchain: getBuildToolchain()
  }

  // The setup steps and plugins said these on the human channel as
  // they ran; the summary carries them with the code each one names.
  const codedWarnings = takeCodedWarnings()

  if (codedWarnings.length > 0) {
    summary = {
      ...summary,
      warnings_count: summary.warnings_count + codedWarnings.length,
      warnings: [...(summary.warnings || []), ...codedWarnings]
    }
  }

  // A silent caller reads it here, where every other warning is.
  if (keptArtifactsLine) {
    summary = {
      ...summary,
      warnings_count: summary.warnings_count + 1,
      warnings: [...(summary.warnings || []), stripAnsi(keptArtifactsLine)]
    }
  }

  const distDisplay = displayPath(displayDistPath)

  const duplicateLines = duplicateGroups.map((group) =>
    messages.duplicateOutputFiles(
      distDisplay,
      group,
      importedAssetSources(stats.compilation, duplicateGroups)
    )
  )

  if (duplicateLines.length > 0) {
    summary = {
      ...summary,
      warnings_count: summary.warnings_count + duplicateLines.length,
      warnings: [
        ...(summary.warnings || []),
        ...duplicateLines.map((line) => stripAnsi(line))
      ]
    }
  }

  // Store readiness for Gecko targets: addons-linter runs over the
  // promoted dist and its findings join the warnings, never the
  // errors. A missing linter is one hint, a broken one says so, and
  // the summary records the outcome either way.
  const lintLines: string[] = []
  let namesOversizeFiles = false

  try {
    const lint = await runAddonLint({
      projectPath: packageJsonDir,
      distPath: displayDistPath,
      distDisplay,
      browser,
      mode: resolvedMode,
      enabled: mergedBuildOptions.addonLint,
      chunkProvenance: () =>
        collectChunkDependencyProvenance(stats.compilation),
      toolchain: summary.toolchain
    })

    summary = {...summary, addon_lint: summarizeAddonLint(lint)}
    namesOversizeFiles = buildNamesOversizeFiles(lint, {
      browser,
      mode: resolvedMode
    })

    if (lint.status === 'missing') {
      if (lint.hint) lintLines.push(lint.hint)
    } else if (lint.status === 'failed') {
      lintLines.push(lint.line)
      if (isDebug()) lintLines.push(lint.debugLine)
    } else if (lint.status === 'linted' && lint.findings > 0) {
      lintLines.push(...lint.lines)
      // Printed, never a warning: it only says where the note is.
      if (lint.reviewerNote) lintLines.push(lint.reviewerNote.line)

      summary = {
        ...summary,
        warnings_count: summary.warnings_count + lint.findings,
        warnings: [
          ...(summary.warnings || []),
          ...lint.lines.map((line) => stripAnsi(line))
        ]
      }
    }
  } catch (lintError) {
    // A store check can never fail a green build, and the note of
    // an earlier lint is retired here as on every other failed path.
    const lint = failedAddonLint(lintError, distDisplay, displayDistPath)
    summary = {...summary, addon_lint: summarizeAddonLint(lint)}
    lintLines.push(lint.line)
    namesOversizeFiles = true
  }

  // A script over the store's parse limit is named by the store
  // check. With no answer, or the check off, the build names it.
  if (namesOversizeFiles) {
    const sizeLines = oversizeSingleFileLines(displayDistPath)

    if (sizeLines.length > 0) {
      lintLines.push(...sizeLines)
      summary = {
        ...summary,
        warnings_count: summary.warnings_count + sizeLines.length,
        warnings: [
          ...(summary.warnings || []),
          ...sizeLines.map((line) => stripAnsi(line))
        ]
      }
    }
  }

  // The docs tell a reader to take the archive path from the build
  // output rather than compose it, so the machine surfaces carry it.
  const zipArtifacts = getZipArtifacts(stats.compilation).map((artifact) => ({
    kind: artifact.kind,
    path: asAskedPath(
      useStagingSwap && artifact.path.startsWith(stagingDistPath)
        ? distPath + artifact.path.slice(stagingDistPath.length)
        : artifact.path
    ),
    size: artifact.size
  }))

  if (zipArtifacts.length > 0) {
    summary = {...summary, zip_artifacts: zipArtifacts}
  }

  // An archive the caller asked for and did not get is a failure, not a
  // warning: `build --zip && upload dist/*.zip` used to exit 0 with none.
  // It is settled here, so neither the summary on disk nor the closer
  // below ever calls this build a success.
  const zipFailures = getZipFailures(stats.compilation)

  if (zipFailures.length > 0) {
    summary = {
      ...summary,
      errors_count: zipFailures.length,
      errors: zipFailures.map(
        (failure) =>
          `${CODES.E_ZIP_SKIPPED}: ${messages.zipArtifactNotCreatedText(
            failure.kind,
            displayPath(failure.path),
            failure.reason
          )}`
      )
    }
  }

  // Hosts that shell out to `extension build` cannot see the returned
  // summary, so persist it next to ready.json. Best-effort only.
  try {
    const summaryFile = buildSummaryPath(packageJsonDir, browser)
    fs.mkdirSync(nodePath.dirname(summaryFile), {recursive: true})
    ensureSessionArtifactsIgnoreFile(packageJsonDir)
    ensureSessionStateInProjectGitignore(packageJsonDir)
    fs.writeFileSync(summaryFile, JSON.stringify(summary))
  } catch {
    // Never fail a green build over the informational contract.
  }

  // Ready names a folder a reader can open: promoted, pruned and
  // summarized. A launch that follows stamps its own ready later.
  // A failed archive leaves that folder in place and the command
  // failing, so the receipt says both and no reader takes it for green.
  if (zipFailures.length > 0) {
    if (heldReceipt()) {
      openReceipt().writeError(
        'build_failed',
        messages.buildFailedOutputInPlace(
          zipFailures.map((failure) =>
            messages.zipArtifactNotCreatedText(
              failure.kind,
              failure.path,
              failure.reason
            )
          ),
          distPath
        ),
        summary.errors
      )
    }
  } else if (!packagingFollows) {
    writeReadyWhenHeld()
  }

  if (zipFailures.length > 0) {
    return {
      summary,
      zipFailure: {
        count: zipFailures.length,
        error: codedError(
          CODES.E_ZIP_SKIPPED,
          zipFailures
            .map((failure) =>
              messages.zipArtifactNotCreated(
                failure.kind,
                displayPath(failure.path),
                failure.reason
              )
            )
            .join('\n')
        )
      }
    }
  }

  if ((info?.warnings || []).length > 0) {
    // Emit-time warnings already printed when the plugin acted; the
    // summary keeps them all so the json record stays complete.
    const warningDetails = messages.buildWarningsDetails(
      (info?.warnings || []).filter((warning) => !isEmitTimeWarning(warning))
    )

    if (warningDetails) {
      humanLine(warningDetails)
    }
  }

  for (const line of duplicateLines) humanLine(line)
  for (const line of lintLines) humanLine(line)

  if (
    resolvedMode === 'production' &&
    browser === 'opera' &&
    mergedBuildOptions.minify === undefined
  ) {
    humanLine(messages.operaBuildUnminified())
  }

  humanLine(
    messages.buildComplete(
      browser,
      distDisplay,
      summary.total_bytes,
      resolvedMode,
      summary.source_map_bytes
    )
  )

  // A packaging step that follows can still fail the build, and marks it then.
  if (!packagingFollows) markBuildTold()

  // The versions a store reviewer has to rebuild under to get these
  // bytes back; the ids inside the bundles depend on the lockfile too.
  // One process builds every target with the same toolchain, so
  // `--browser all` reads the sentence once, not after every browser.
  if (
    resolvedMode === 'production' &&
    summary.toolchain &&
    !toolchainLinePrinted.has(packageJsonDir)
  ) {
    toolchainLinePrinted.add(packageJsonDir)
    humanLine(messages.buildToolchain(summary.toolchain))
  }

  for (const artifact of zipArtifacts) {
    const zipDisplay = displayPath(artifact.path)
    humanLine(messages.zipArtifactReady(zipDisplay, artifact.size))
  }

  return {summary}
}
