// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {BuildSummary} from '../lib/build-summary'
import {codedError} from '../lib/coded-error'
import * as messages from '../lib/messages'
import {CODES} from '../lib/messaging'
import type {NormalizedBrowser} from '../lib/paths'
import type {resolveSafariIdentity} from '../lib/safari-identity'
import {buildSummaryPath} from '../lib/session-paths'
import {stampReadyKnownExtensionId} from '../plugin-playwright'
import type {BuildOptions} from '../types'
import {printedBuildFailures} from './build-failure'

// The packager reads the folder the bundler actually emitted into, which
// under a re-pointed output.path is not dist/<browser>.
export async function packageSafariApp(input: {
  safariPackager: NonNullable<BuildOptions['safariPackager']>
  safariIdentity: ReturnType<typeof resolveSafariIdentity>
  displayDistPath: string
  summary: BuildSummary
  packageJsonDir: string
  browser: NormalizedBrowser
  liveDevSession: unknown
}): Promise<BuildSummary> {
  const {
    safariPackager,
    safariIdentity,
    displayDistPath,
    packageJsonDir,
    browser,
    liveDevSession
  } = input
  let summary = input.summary

  if (!fs.existsSync(displayDistPath)) {
    throw codedError(
      CODES.E_PREVIEW_NO_DIST,
      messages.safariBuildOutputNotFound(displayDistPath)
    )
  }

  let safari: Awaited<ReturnType<typeof safariPackager>>

  try {
    safari = await safariPackager(displayDistPath, 'full', safariIdentity)
  } catch (packagerError) {
    // The packager marks a failed tool it printed, with that tool's output.
    if (
      packagerError instanceof Error &&
      (packagerError as {printed?: unknown}).printed === true
    ) {
      printedBuildFailures.add(packagerError)
    }

    throw packagerError
  }

  // The app identity (and whether the bundle id was generated rather than
  // user-owned) was a human log line only. Fold it into the summary so a
  // programmatic caller does not have to read project.pbxproj to learn it.
  if (safari) {
    summary = {...summary, safari}

    try {
      fs.writeFileSync(
        buildSummaryPath(packageJsonDir, browser),
        JSON.stringify(summary)
      )
    } catch {
      // Never fail a green build over the informational contract.
    }

    // Safari registers the extension under the appex identity,
    // `<bundleId>.Extension`, so that is the truthful ready.json id.
    if (safari.bundleId && !liveDevSession) {
      stampReadyKnownExtensionId(
        packageJsonDir,
        browser,
        `${safari.bundleId}.Extension`
      )
    }
  }

  return summary
}
