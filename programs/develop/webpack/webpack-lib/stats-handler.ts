// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {scrubBrand} from './branding'

export function handleStatsErrors(stats: any): void {
  try {
    const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

    const str = stats.toString({
      colors: true,
      all: false,
      errors: true,
      warnings: !!verbose
    })

    if (str) console.error(scrubBrand(str))
  } catch {
    try {
      const str = stats.toString({
        colors: true,
        all: false,
        errors: true,
        warnings: true
      })
      if (str) console.error(scrubBrand(str))
    } catch {
      // Ignore if stats.toString fails
    }
  }
}
