//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type Browser =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'

export function isSafariVendor(value: string): boolean {
  return value === 'safari' || value === 'webkit-based'
}

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

// Install targets differ from run/build targets: `install all` must also
// cover Chromium, the default dev/start launch target.
export const installTargets = (browser?: Browser | 'all') => {
  return browser === 'all'
    ? ['chrome', 'chromium', 'edge', 'firefox']
    : vendors(browser)
}

// Reports validity instead of exiting: a shared helper that calls
// process.exit leaves the caller no way to wrap the failure in its own output.
export function validateVendors(
  vendorsList: string[],
  onInvalid: (invalid: string, supported: string[]) => void
): boolean {
  const supported = [
    'chrome',
    'edge',
    'firefox',
    'chromium',
    'brave',
    'opera',
    'vivaldi',
    'yandex',
    'waterfox',
    'librewolf',
    'chromium-based',
    'gecko-based',
    'firefox-based',
    'safari',
    'webkit-based'
  ]
  for (const v of vendorsList) {
    if (!supported.includes(v)) {
      onInvalid(v, supported)
      return false
    }
  }

  return true
}
