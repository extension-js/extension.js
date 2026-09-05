// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// True when the emitted manifest overrides the new tab page. The prefixed
// keys count too: a raw add-on directory may never have been de-prefixed.
export function manifestDeclaresNewtabOverride(outPath: string): boolean {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outPath, 'manifest.json'), 'utf-8')
    )
    const overrides =
      manifest?.chrome_url_overrides ||
      manifest?.['chromium:chrome_url_overrides'] ||
      manifest?.['chrome:chrome_url_overrides'] ||
      manifest?.['gecko:chrome_url_overrides'] ||
      manifest?.['firefox:chrome_url_overrides']
    return Boolean(
      overrides &&
        typeof overrides.newtab === 'string' &&
        overrides.newtab.trim().length > 0
    )
  } catch {
    return false
  }
}
