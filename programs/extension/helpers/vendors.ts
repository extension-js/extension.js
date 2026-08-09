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

// Single source for every target the parser accepts, in display order.
// Help strings and validateVendors both read this list, so a vendor added
// here is discoverable from --help the same day it parses.
export const SUPPORTED_BROWSER_TARGETS = [
  'chrome',
  'chromium',
  'edge',
  'firefox',
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

export const BROWSER_TARGETS_HELP = SUPPORTED_BROWSER_TARGETS.join(' | ')

// start/preview refuse the webkit family on purpose, so their help lists
// every accepted target except safari and webkit-based.
export const NO_SAFARI_BROWSER_TARGETS_HELP = SUPPORTED_BROWSER_TARGETS.filter(
  (target) => !isSafariVendor(target)
).join(' | ')

export function parseOptionalBoolean(value?: string): boolean {
  if (typeof value === 'undefined') return true
  const normalized = String(value).trim().toLowerCase()
  return !['false', '0', 'no', 'off'].includes(normalized)
}

export const vendors = (browser?: Browser | 'all') => {
  const value = (browser ?? 'chromium') as string
  return value === 'all'
    ? ['chrome', 'edge', 'firefox']
    : String(value)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
}

// Names `extension install` / `extension uninstall` accept, including family
// aliases. Run/build still use SUPPORTED_BROWSER_TARGETS (forks, Safari, …);
// managed binary ops share this narrower list in both directions.
export const MANAGED_INSTALL_TARGETS = [
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'chromium-based',
  'gecko-based',
  'firefox-based'
] as const

export const MANAGED_INSTALL_TARGETS_HELP = [
  ...MANAGED_INSTALL_TARGETS,
  'all'
].join(' | ')

// Concrete cache dirs written by install / removed by uninstall. `all` expands
// to this set; family aliases normalize onto these names before the path call.
export const MANAGED_INSTALL_BINARIES = [
  'chrome',
  'chromium',
  'edge',
  'firefox'
] as const

// Install targets differ from run/build targets: `install all` must also
// cover Chromium, the default dev/start launch target. Same expansion for
// uninstall so both commands operate on one binary set.
export const installTargets = (browser?: Browser | 'all') => {
  return browser === 'all' ? [...MANAGED_INSTALL_BINARIES] : vendors(browser)
}

// Reports validity instead of exiting: a shared helper that calls
// process.exit leaves the caller no way to wrap the failure in its own output.
export function validateVendors(
  vendorsList: string[],
  onInvalid: (invalid: string, supported: string[]) => void
): boolean {
  const supported = SUPPORTED_BROWSER_TARGETS
  for (const v of vendorsList) {
    if (!supported.includes(v)) {
      onInvalid(v, supported)
      return false
    }
  }

  return true
}

// Install/uninstall only accept managed binary names (plus family aliases).
// Same predicate for install, uninstall, and their --where paths so a name
// accepted in one direction is never rejected in the other.
export function validateManagedInstallTargets(
  targetsList: string[],
  onInvalid: (invalid: string, supported: string[]) => void
): boolean {
  const supported = [...MANAGED_INSTALL_TARGETS]
  for (const v of targetsList) {
    if (!supported.includes(v as (typeof MANAGED_INSTALL_TARGETS)[number])) {
      onInvalid(v, supported)
      return false
    }
  }

  return true
}

// Three-way split for install/uninstall scripts that branch on the envelope
// code alone:
//   managed         → proceed (download/remove/locate)
//   not-installable → known CLI vendor, never fetched (brave/safari/forks)
//   unknown         → typo / name outside SUPPORTED_BROWSER_TARGETS
export type ManagedInstallTargetClass =
  | 'managed'
  | 'not-installable'
  | 'unknown'

const MANAGED_INSTALL_TARGET_SET = new Set<string>(MANAGED_INSTALL_TARGETS)
const SUPPORTED_BROWSER_TARGET_SET = new Set<string>(SUPPORTED_BROWSER_TARGETS)

export function classifyManagedInstallTarget(
  name: string
): ManagedInstallTargetClass {
  const value = String(name || '')
    .trim()
    .toLowerCase()
  if (!value) return 'unknown'
  if (MANAGED_INSTALL_TARGET_SET.has(value)) return 'managed'
  if (SUPPORTED_BROWSER_TARGET_SET.has(value)) return 'not-installable'
  return 'unknown'
}

// First non-managed name wins so comma lists surface one refusal code.
export function firstNonManagedInstallTarget(
  targetsList: string[]
): {name: string; kind: Exclude<ManagedInstallTargetClass, 'managed'>} | null {
  for (const name of targetsList) {
    const kind = classifyManagedInstallTarget(name)
    if (kind !== 'managed') return {name, kind}
  }
  return null
}
