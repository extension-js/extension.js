// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {type Channel, prefix} from '../../lib/messaging'

export function serverRestartRequiredFromManifestError(
  fileAdded: string,
  fileRemoved: string
) {
  const lines: string[] = []
  lines.push(`Entrypoint references changed.`)
  if (fileRemoved) {
    lines.push(`${colors.gray('EXPECTED')} ${colors.underline(fileRemoved)}`)
  }
  if (fileAdded) {
    lines.push(`${colors.gray('GOT')} ${colors.underline(fileAdded)}`)
  }
  lines.push(
    `Restart the dev server to pick up changes to manifest entrypoints.`
  )
  return lines.join('\n')
}

export function legacyManifestPathWarning(
  field: string,
  legacyPath: string,
  modernPath: string
) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} The ${colors.blue(field)} field uses a deprecated scaffold path.`
  )
  lines.push(`${colors.gray('PATH')} ${colors.underline(legacyPath)}`)
  lines.push(
    `Point it at ${colors.underline(modernPath)}, Extension.js already emits the page there.`
  )
  return lines.join('\n')
}

export function fatalManifestShapeFixed(field: string, detail: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} Repaired the ${colors.blue(field)} field, which Chrome refuses to load the extension over.`
  )
  lines.push(`${colors.gray('REASON')} ${colors.underline(detail)}`)
  lines.push(`Fix the field in your ${colors.blue('manifest.json')} file.`)
  return lines.join('\n')
}

export function invalidThemeValue(
  field: string,
  detail: string,
  value: string
) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow(field)} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(detail)
  lines.push(
    `Chrome rejects the whole extension when this value is malformed.\nThe build stops here to protect you.`
  )
  lines.push('')
  lines.push(`${colors.red('INVALID VALUE')} ${value}`)
  return lines.join('\n')
}

export function themeNotSupportedByBrowser(browser: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.blue(browser)} does not support the ${colors.yellow('theme')} field.`
  )
  lines.push(`The field ships unchanged in the manifest and Safari ignores it.`)
  return lines.join('\n')
}

export function missingGeckoDataCollectionPermissions() {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} addons.mozilla.org requires ${colors.blue('browser_specific_settings.gecko.data_collection_permissions')} for new add-ons.`
  )
  lines.push(
    `Declare ${colors.blue('{"required": ["none"]}')} if this extension transmits no data.`
  )
  lines.push(
    `See ${colors.underline('https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/')} for details.`
  )
  return lines.join('\n')
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  const lines: string[] = []
  lines.push(`Can't read your ${colors.blue('manifest.json')} file.`)
  lines.push(`${colors.gray('REASON')} ${colors.underline(String(error))}`)
  lines.push(`Update your manifest and try again.`)
  return lines.join('\n')
}

export function manifestIncludeSummary(browser: string, manifestPath: string) {
  return (
    `${prefix('debug')} manifest include browser=${browser} ` +
    `path=${manifestPath}`
  )
}

export function manifestEmitSuccess() {
  return `${prefix('debug')} manifest emitted=true schemaStripped=true`
}

export function manifestOverridesSummary(
  overrideKeys: number,
  devCssStubsAdded: number
) {
  return (
    `${prefix('debug')} manifest overrides keys=${String(overrideKeys)} ` +
    `devCssStubs=${String(devCssStubsAdded)}`
  )
}

export function manifestDepsTracked(addedCount: number) {
  return `${prefix('debug')} manifest deps=${String(addedCount)}`
}

export function manifestLegacyWarningsSummary(count: number) {
  return `${prefix('debug')} manifest legacyWarnings=${String(count)}`
}

export function pageActionNotSupportedByBrowser(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} does not show the ${colors.yellow('page_action')} address bar surface.\n` +
    'The field was dropped from the built manifest and its page was not emitted.'
  )
}

export function pageActionDroppedForBrowserAction(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} refuses a Manifest V2 manifest that declares both ${colors.yellow('browser_action')} and ${colors.yellow('page_action')}.\n` +
    `The build kept ${colors.yellow('browser_action')} and dropped ${colors.yellow('page_action')} from the built manifest, so its page was not emitted. ` +
    'Remove one of the two keys, or scope page_action with the firefox: prefix.'
  )
}

export function vendorPrefixedKeyDropped(
  key: string,
  familyKey: string,
  vendor: 'chrome' | 'edge',
  browser: string
) {
  const vendorName = vendor === 'edge' ? 'Edge' : 'Chrome'
  return (
    `${prefix('warn')} ${colors.yellow(key)} now applies only to ${vendorName} builds, so the ${colors.blue(browser)} build dropped it.\n` +
    `Rename it to ${colors.yellow(familyKey)} to keep it on every Chromium-based browser. ` +
    `Leave it as is if it's meant for ${vendorName} only.`
  )
}

export function mv2SandboxPolicyDropped(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} reads a Manifest V2 ${colors.yellow('content_security_policy')} as one string, so the ${colors.yellow('sandbox')} slot has nowhere to go.\n` +
    `The build wrote the ${colors.yellow('extension_pages')} policy as that string and dropped the sandbox policy from the built manifest. ` +
    'Scope the object form with the chromium: prefix, or declare a Manifest V3 build for this browser.'
  )
}

export function geckoSidePanelUnsupported(file: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.underline(file)} uses chrome.sidePanel, which is Chromium only.`
  )
  lines.push(
    `Firefox opens a sidebar through the ${colors.yellow('sidebar_action')} manifest key on every manifest version, and addons-linter flags the call as UNSUPPORTED_API.`
  )
  lines.push(
    `Move the call behind a build-time branch on ${colors.blue('import.meta.env.EXTENSION_PUBLIC_BROWSER')} so the Firefox bundle drops it.`
  )
  return lines.join('\n')
}

export function safariSidePanelUnsupported(file: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.underline(file)} calls chrome.sidePanel, which Safari does not have.`
  )
  lines.push(
    `The call throws when the script runs. In a background service worker, Safari then never starts the worker, and nothing reports an error.`
  )
  lines.push(
    `Move the call behind a build-time branch on ${colors.blue('import.meta.env.EXTENSION_PUBLIC_BROWSER')}, or guard it with ${colors.yellow('chrome.sidePanel?.')}.`
  )
  return lines.join('\n')
}

export function geckoActionUnsupportedOnMv2(file: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.underline(file)} uses chrome.action, which Manifest V2 does not have on Firefox.`
  )
  lines.push(
    `Firefox Manifest V2 exposes the toolbar button as browserAction, and addons-linter flags the call as UNSUPPORTED_API.`
  )
  lines.push(
    `Use browserAction behind a build-time branch on ${colors.blue('import.meta.env.EXTENSION_PUBLIC_BROWSER')}, or declare Manifest V3 for Firefox with ${colors.yellow('firefox:manifest_version')}.`
  )
  return lines.join('\n')
}
