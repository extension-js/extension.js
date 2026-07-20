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
}

export function getBuildSummary(
  browser: string,
  info: {
    assets?: Array<{size?: number}>
    warnings?: unknown[]
    errors?: unknown[]
  } | null
): BuildSummary {
  const assets = info?.assets || []

  return {
    browser,
    total_assets: assets.length,
    total_bytes: assets.reduce((n, a) => n + (a.size || 0), 0),
    largest_asset_bytes: assets.reduce((m, a) => Math.max(m, a.size || 0), 0),
    warnings_count: (info?.warnings || []).length,
    errors_count: (info?.errors || []).length
  }
}
