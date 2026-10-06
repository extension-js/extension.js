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

// `folders: {public: false}` stops the copy, and the files the manifest still
// reaches in public/ go missing with it. Names each one and says why.
export function manifestFilesInTurnedOffPublic(files: string[]) {
  return [
    'manifest.json names files that the build did not emit:',
    ...files.map((file) => `  - ${colors.underline(file)}`),
    `The public folder is turned off, ${colors.blue('folders.public')} is ${colors.blue('false')} in extension.config.js, so nothing inside public/ ships.`,
    'Turn the folder back on, or move these files out of public/ and name them by their path in the project.'
  ].join('\n')
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

export function manifestFieldMistyped(
  field: string,
  expected: string,
  received: string
) {
  const lines: string[] = []
  lines.push(
    `The ${colors.blue(field)} field in your ${colors.blue('manifest.json')} must be ${expected}.`
  )

  lines.push(`${colors.gray('GOT')} ${colors.underline(received)}`)
  lines.push(
    `No browser loads the extension with it written this way, so the build stops here. Rewrite the field as ${expected} and try again.`
  )

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

function prefixScope(prefix: string) {
  if (prefix === 'chrome') return 'Chrome'
  if (prefix === 'edge') return 'Edge'
  if (prefix === 'chromium') return 'Chromium-based'
  if (prefix === 'firefox' || prefix === 'gecko') return 'Firefox-based'
  if (prefix === 'safari' || prefix === 'webkit') return 'Safari'

  return prefix
}

export function manifestVersionLostForBrowser(
  browser: string,
  prefixedKeys: string[],
  resolved: unknown
) {
  const target = colors.blue(browser)
  const field = colors.yellow('manifest_version')
  const scoped = prefixedKeys.map((key) => {
    const scope = prefixScope(key.substring(0, key.indexOf(':')))

    return `${colors.yellow(key)} applies only to ${scope} builds`
  })
  const lead =
    resolved === undefined
      ? scoped.length
        ? `${scoped.join(', ')}, so the ${target} build has no ${field}.`
        : `The ${target} build has no ${field}.`
      : `The ${target} build resolved ${field} to ${colors.yellow(JSON.stringify(resolved))}, and browsers load only 2 or 3.`

  return (
    `${prefix('error')} ${lead}\n` +
    `No browser loads a manifest without it, so the build was refused. ` +
    `Add a plain ${field}, or scope one to this browser: ${colors.yellow('chromium:manifest_version')} for every Chromium-based browser, ${colors.yellow('firefox:manifest_version')} for Firefox.`
  )
}

export function edgeStoreKeyDropped(browser: string) {
  return (
    `${prefix('warn')} Edge Add-ons refuses a package whose manifest carries ${colors.yellow('key')}, so the ${colors.blue(browser)} production build dropped it.\n` +
    `Partner Center assigns the id that ${colors.yellow('key')} pins everywhere else, so the field has no use in this package. ` +
    `Write it as ${colors.yellow('chrome:key')} if it is meant for the Chrome Web Store build only.`
  )
}

export function mv2SandboxPolicyDropped(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} reads a Manifest V2 ${colors.yellow('content_security_policy')} as one string, so the ${colors.yellow('sandbox')} slot has nowhere to go.\n` +
    `The build wrote the ${colors.yellow('extension_pages')} policy as that string and dropped the sandbox policy from the built manifest. ` +
    'Scope the object form with the chromium: prefix, or declare a Manifest V3 build for this browser.'
  )
}

export function mv3StringPolicyRewritten(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} reads a Manifest V3 ${colors.yellow('content_security_policy')} as an object, and the manifest wrote the Manifest V2 string form.\n` +
    `The build moved that string into the ${colors.yellow('extension_pages')} slot, which is what the browser refuses to install the extension without. ` +
    'Write the object form in manifest.json, or scope the string with the firefox: prefix for a Manifest V2 build.'
  )
}

export function mv3BrowserActionFoldedIntoAction(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} replaced ${colors.yellow('browser_action')} with ${colors.yellow('action')} in Manifest V3, so the toolbar button never opens under the old key.\n` +
    `The build wrote the key as ${colors.yellow('action')} in the built manifest. ` +
    'Rename it in manifest.json, or scope it with the firefox: prefix for a Manifest V2 build.'
  )
}

export function mv2ActionFoldedIntoBrowserAction(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} resolved ${colors.yellow('manifest_version')} to 2, and Manifest V2 has no ${colors.yellow('action')} key, so the toolbar button and its popup never load.\n` +
    `The build wrote the key as ${colors.yellow('browser_action')} in the built manifest, pointing at the same compiled popup. ` +
    `Scope the Manifest V3 key with the chromium: prefix, or declare ${colors.yellow('firefox:manifest_version')} 3 to keep it.`
  )
}

export function sidebarKeyTranslatedForBrowser(
  browser: string,
  from: string,
  to: string
) {
  const permission =
    to === 'side_panel'
      ? `, and added the ${colors.yellow('sidePanel')} permission the panel needs to appear`
      : ''

  return (
    `${prefix('warn')} ${colors.blue(browser)} reads a sidebar only from ${colors.yellow(to)}, and the manifest declared ${colors.yellow(from)} alone, so the panel never opens.\n` +
    `The build wrote the key as ${colors.yellow(to)} in the built manifest${permission}, pointing at the same compiled page. ` +
    `Declare both keys to ship a panel of its own per vendor, or scope ${colors.yellow(from)} with a prefix to keep it off this build.`
  )
}

export function mv3BackgroundPageUnsupported(browser: string) {
  return (
    `${prefix('warn')} ${colors.blue(browser)} has no ${colors.yellow('background.page')} in Manifest V3, and the extension installs with no background context at all.\n` +
    'Nothing reports that at load time: the background code, the reload bridge and the control channel all go missing silently. ' +
    'The build kept the page as written, so the rest of the extension still loads. ' +
    `Declare ${colors.yellow('background.service_worker')} instead, or scope the page with the firefox: prefix for a Manifest V2 build.`
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

// Safari ships no counterpart for these namespaces, so the member read itself
// throws and the background dies before it can report anything.
function safariUnsupportedApi(file: string, api: string, detail: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.underline(file)} calls chrome.${api}, which Safari does not have.`
  )

  lines.push(detail)
  lines.push(
    `Move the call behind a build-time branch on ${colors.blue('import.meta.env.EXTENSION_PUBLIC_BROWSER')}, or guard it with ${colors.yellow(`chrome.${api}?.`)}.`
  )

  return lines.join('\n')
}

const safariBackgroundDies =
  'The call throws when the script runs, Safari drops the background, and nothing reports an error.'

export function safariSidePanelUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'sidePanel',
    `The call throws when the script runs. In a background service worker, Safari then never starts the worker, and nothing reports an error.`
  )
}

export function safariOffscreenUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'offscreen',
    `Safari has no offscreen documents, so that DOM work has no place to run. ${safariBackgroundDies}`
  )
}

export function safariTabGroupsUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'tabGroups',
    `Safari has no tab groups, and its tabs carry no group id. ${safariBackgroundDies}`
  )
}

export function safariManagementUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'management',
    `Safari exposes no management namespace at all, not even getSelf. ${safariBackgroundDies}`
  )
}

export function safariUserScriptsUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'userScripts',
    `Safari has no userScripts namespace, and scripting.registerContentScripts is the closest it offers. ${safariBackgroundDies}`
  )
}

export function safariIdentityUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'identity',
    `Safari has no identity namespace, and Apple points OAuth flows at a normal tab instead. ${safariBackgroundDies}`
  )
}

export function safariNotificationsUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'notifications',
    `Safari has no notifications namespace, so a page has to raise the web Notification instead. ${safariBackgroundDies}`
  )
}

export function safariOmniboxUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'omnibox',
    `Safari has no omnibox keyword API. ${safariBackgroundDies}`
  )
}

export function safariBookmarksUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'bookmarks',
    `Safari does not expose bookmarks to extensions on any version. ${safariBackgroundDies}`
  )
}

export function safariHistoryUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'history',
    `Safari does not expose browsing history to extensions on any version. ${safariBackgroundDies}`
  )
}

export function safariDownloadsUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'downloads',
    `Safari has no downloads namespace. ${safariBackgroundDies}`
  )
}

export function safariIdleUnsupported(file: string) {
  return safariUnsupportedApi(
    file,
    'idle',
    `Safari has no idle namespace. ${safariBackgroundDies}`
  )
}

// Safari ships these namespaces but not these members, so the namespace
// resolves and the throw waits one level deeper. Keyed api.member, and the
// step's member table is held to this list by a spec so neither can drift.
export const safariMissingMemberDetails: Record<string, string> = {
  'action.getUserSettings': `Safari has no pinned-state query for the toolbar button, so there is no function to call. ${safariBackgroundDies}`,
  'action.getBadgeTextColor': `Safari draws the badge in its own colors and offers no badge text color call. ${safariBackgroundDies}`,
  'action.setBadgeTextColor': `Safari draws the badge in its own colors and offers no badge text color call. ${safariBackgroundDies}`,
  'action.onUserSettingsChanged': `Safari raises no event when the toolbar button settings change, so the listener attaches to nothing. ${safariBackgroundDies}`,
  'storage.managed': `Safari has no managed storage area, since it carries no enterprise policy channel for web extensions. ${safariBackgroundDies}`,
  'runtime.getContexts': `Safari keeps no inventory of extension contexts to hand back. ${safariBackgroundDies}`,
  'runtime.onSuspend': `Safari tears a background down without announcing it, so this lifecycle event does not exist. ${safariBackgroundDies}`,
  'runtime.onSuspendCanceled': `Safari tears a background down without announcing it, so this lifecycle event does not exist. ${safariBackgroundDies}`,
  'runtime.onUpdateAvailable': `Safari ships an extension inside its host app, so the browser raises no update event for it. ${safariBackgroundDies}`,
  'declarativeNetRequest.getAvailableStaticRuleCount': `Safari implements the blocking core of declarativeNetRequest and not its rule-budget queries. ${safariBackgroundDies}`,
  'declarativeNetRequest.getDisabledRuleIds': `Safari cannot disable individual static rules, so it has nothing to report here. ${safariBackgroundDies}`,
  'declarativeNetRequest.updateStaticRules': `Safari cannot toggle individual static rules, only whole rulesets through updateEnabledRulesets. ${safariBackgroundDies}`,
  'declarativeNetRequest.testMatchOutcome': `Safari has no rule-matching test harness, which is a Chrome debugging aid. ${safariBackgroundDies}`,
  'declarativeNetRequest.onRuleMatchedDebug': `Safari raises no rule-match debug event, which Chrome offers to unpacked extensions only. ${safariBackgroundDies}`,
  'tabs.group': `Safari has no tab groups at all, so there is no group to move a tab into. ${safariBackgroundDies}`,
  'tabs.ungroup': `Safari has no tab groups at all, so there is no group to take a tab out of. ${safariBackgroundDies}`,
  'webNavigation.onCreatedNavigationTarget': `Safari reports the main navigation events only, and this one is not among them. ${safariBackgroundDies}`,
  'webNavigation.onHistoryStateUpdated': `Safari reports the main navigation events only, so a History API navigation goes unannounced. ${safariBackgroundDies}`,
  'webNavigation.onReferenceFragmentUpdated': `Safari reports the main navigation events only, so a fragment change goes unannounced. ${safariBackgroundDies}`,
  'webNavigation.onTabReplaced': `Safari reports the main navigation events only, and this one is not among them. ${safariBackgroundDies}`,
  'windows.onBoundsChanged': `Safari raises no event when a window is moved or resized. ${safariBackgroundDies}`
}

// The member sits on a namespace Safari does have, so the message names the
// member and the guard goes at the member, not at the namespace above it.
export function safariMemberUnsupported(
  file: string,
  api: string,
  member: string,
  kind: 'call' | 'read'
) {
  const guard =
    kind === 'call'
      ? `chrome.${api}.${member}?.()`
      : `chrome.${api}.${member}?.`
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.underline(file)} calls chrome.${api}.${member}, which Safari does not have.`
  )

  lines.push(
    safariMissingMemberDetails[`${api}.${member}`] ||
      `Safari ships chrome.${api} without this member. ${safariBackgroundDies}`
  )

  lines.push(
    `Safari has ${colors.blue(`chrome.${api}`)} itself, so a guard on the namespace does not help. Move the call behind a build-time branch on ${colors.blue('import.meta.env.EXTENSION_PUBLIC_BROWSER')}, or guard it with ${colors.yellow(guard)}.`
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

export function contentScriptEntryDroppedForBrowser(
  index: number,
  browser: string,
  prefixedKeys: string[]
) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.yellow(`content_scripts[${String(index)}]`)} has no js and no css in the ${colors.blue(browser)} build, so the build left it out.`
  )

  if (prefixedKeys.length > 0) {
    lines.push(
      `${prefixedKeys.map((key) => colors.yellow(key)).join(', ')} ${prefixedKeys.length === 1 ? 'applies' : 'apply'} to another browser. Add ${colors.yellow(`${browser}:js`)} or a plain ${colors.yellow('js')} to keep the entry here.`
    )
  }

  return lines.join('\n')
}

// Safari inherits chromium: keys by design, so a dropped key would otherwise
// vanish with no trace and the user would debug a feature that never loaded.
export function webkitUnsupportedKeysDropped(
  browser: string,
  dropped: Array<{path: string; reason: string}>
) {
  const count = dropped.length
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} Safari has no support for ${String(count)} manifest ${count === 1 ? 'key' : 'keys'} this project declares, so the ${colors.blue(browser)} build dropped ${count === 1 ? 'it' : 'them'}.`
  )

  for (const entry of dropped) {
    lines.push(`${colors.yellow(entry.path)} ${colors.gray(entry.reason)}`)
  }

  lines.push(
    `Every key above is inert on Safari, so the built app lost nothing it could have run. Declare a Safari-only replacement with the ${colors.yellow('safari:')} prefix if you have one.`
  )

  return lines.join('\n')
}
