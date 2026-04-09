//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

export type Browser =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'

export function parseOptionalBoolean(value?: string): boolean {
  if (typeof value === 'undefined') return true
  const normalized = String(value).trim().toLowerCase()
  return !['false', '0', 'no', 'off'].includes(normalized)
}

export const vendors = (browser?: Browser | 'all') => {
  const value = (browser ?? 'chromium') as string
  return value === 'all'
    ? ['chrome', 'edge', 'firefox']
    : String(value).split(',')
}

export function validateVendorsOrExit(
  vendorsList: string[],
  onInvalid: (invalid: string, supported: string[]) => void
) {
  const supported = [
    'chrome',
    'edge',
    'firefox',
    'chromium',
    'chromium-based',
    'gecko-based',
    'firefox-based'
  ]
  for (const v of vendorsList) {
    if (!supported.includes(v)) {
      onInvalid(v, supported)
      process.exit(1)
    }
  }
}
