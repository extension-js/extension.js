// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

/**
 * What the injected Safari packager reports back about the app it produced.
 * `bundleIdDerived` is the load-bearing one: a generated `dev.extensionjs.*`
 * identifier comes from the app name, so every project built from the same
 * source shares it and the first registration takes it.
 */
export interface SafariPackageSummary {
  appName?: string
  bundleId?: string
  bundleIdDerived?: boolean
  appPath?: string
  xcodeProjectPath?: string
  macOsOnly?: boolean
}

// What the addons.mozilla.org store check did, so a consumer can tell a
// clean lint from one that never ran. Only a Gecko production build lints.
export type AddonLintSummary =
  | {status: 'linted'; findings: number}
  | {status: 'missing'}
  | {status: 'failed'; reason: string}
  | {status: 'skipped'; reason: 'disabled' | 'mode' | 'browser'}

export type BuildSummary = {
  browser: string
  /** Absolute dist directory the build emitted into. Hosts that shell out
   * would otherwise have to re-derive `<project>/dist/<browser>` themselves. */
  output_path?: string
  total_assets: number
  total_bytes: number
  largest_asset_bytes: number
  warnings_count: number
  errors_count: number
  /** Plain-text warning messages (ANSI-stripped, capped) so programmatic
   * consumers get a structured channel instead of scraping stdout. */
  warnings?: string[]
  /** Present only for safari/webkit-based builds that ran the packager. */
  safari?: SafariPackageSummary
  addon_lint?: AddonLintSummary
  /** Archives this build wrote, with their promoted paths. The name is
   * rewritten from the manifest, so a caller reads it here rather than
   * composing it. Absent when neither --zip nor --zip-source was asked for. */
  zip_artifacts?: Array<{
    kind: 'source' | 'dist'
    path: string
    size: number
  }>
}

const MAX_SUMMARY_WARNINGS = 20

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

export function getBuildSummary(
  browser: string,
  info: {
    assets?: Array<{size?: number}>
    warnings?: unknown[]
    errors?: unknown[]
  } | null,
  outputPath?: string,
  outputFiles?: Array<{size: number}>
): BuildSummary {
  // The stats list leaves out source maps, so the files found in the output
  // folder are what the totals count whenever the folder could be read.
  const assets: Array<{size?: number}> = outputFiles?.length
    ? outputFiles
    : info?.assets || []
  const warnings = (info?.warnings || [])
    .slice(0, MAX_SUMMARY_WARNINGS)
    .map((warning) => {
      const message =
        warning && typeof warning === 'object'
          ? String((warning as {message?: unknown}).message ?? '')
          : String(warning ?? '')

      return message.replace(ANSI_PATTERN, '').trim()
    })
    .filter(Boolean)

  return {
    browser,
    ...(outputPath ? {output_path: outputPath} : {}),
    total_assets: assets.length,
    total_bytes: assets.reduce((n, a) => n + (a.size || 0), 0),
    largest_asset_bytes: assets.reduce((m, a) => Math.max(m, a.size || 0), 0),
    warnings_count: (info?.warnings || []).length,
    errors_count: (info?.errors || []).length,
    ...(warnings.length ? {warnings} : {})
  }
}
