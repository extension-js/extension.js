// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type BuildSummary = {
  browser: string
  total_assets: number
  total_bytes: number
  largest_asset_bytes: number
  warnings_count: number
  errors_count: number
  /** Plain-text warning messages (ANSI-stripped, capped) so programmatic
   * consumers get a structured channel instead of scraping stdout. */
  warnings?: string[]
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
  } | null
): BuildSummary {
  const assets = info?.assets || []
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
    total_assets: assets.length,
    total_bytes: assets.reduce((n, a) => n + (a.size || 0), 0),
    largest_asset_bytes: assets.reduce((m, a) => Math.max(m, a.size || 0), 0),
    warnings_count: (info?.warnings || []).length,
    errors_count: (info?.errors || []).length,
    ...(warnings.length ? {warnings} : {})
  }
}
