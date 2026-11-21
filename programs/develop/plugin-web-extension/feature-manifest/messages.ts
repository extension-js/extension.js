// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {isGeckoBasedBrowser} from '../../lib/constants'
import {browserDisplayName, prefix} from '../../lib/messaging'
import type {ShadowedDeclaration} from './manifest-lib/shadowed-declaration'
import {formatThemeArray} from './manifest-lib/theme-values'

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

// The manifest names a file that is not in the output folder, so the
// browser would refuse the extension. Names each file and the usual cause.
export function manifestFilesNotEmitted(files: string[]) {
  const shown = files.slice(0, 5)

  return [
    'manifest.json names files that this build did not write to the output folder:',
    ...shown.map((file) => `  - ${file}`),
    ...(files.length > shown.length
      ? [`  and ${files.length - shown.length} more`]
      : []),
    '',
    'A dev session keeps the manifest.json of the last good build, so the browser never loads one that names a missing file.',
    'Most often a plugin or a config hook of the project edits manifest.json and names a file that no entry produces. Name a file the build writes, or emit that file from the same plugin.',
    'When nothing in the project edits manifest.json, the manifest and the files the build wrote disagree. Save a source file to build again, and report it with the list above if the same files come back.'
  ].join('\n')
}

export function manifestPersistFailed(reason: string) {
  return [
    'The build could not write manifest.json to the output folder.',
    `${colors.gray('REASON')} ${reason}`,
    'Check that the output folder is writable and that no other program holds manifest.json open, then save a file to build again.'
  ].join('\n')
}

// How a missing permission warning opens and which key its fix names. A
// prefixed key that took the plain list's place is named, not "undeclared".
export function undeclaredPermissionWording(
  api: string,
  shadow?: ShadowedDeclaration
): {lead: string; fixKey: string} {
  if (shadow?.kind === 'replaced') {
    return {
      lead:
        `manifest.json lists the "${api}" permission under ` +
        `${shadow.listedUnder}, and ${shadow.readKey} replaces that key in ` +
        `the ${shadow.browser} build. A prefixed key replaces the ` +
        `unprefixed one for that browser and does not merge with it, so ` +
        `this build has no "${api}", but `,
      fixKey: shadow.readKey
    }
  }

  if (shadow?.kind === 'elsewhere') {
    return {
      lead:
        `manifest.json lists the "${api}" permission under ` +
        `${shadow.listedUnder}, a key the ${shadow.browser} build does not ` +
        `read, but `,
      fixKey: shadow.readKey
    }
  }

  return {
    lead: `manifest.json does not declare the "${api}" permission, but `,
    fixKey: 'permissions'
  }
}

// A shippable build grants nothing on its own, so a call that leans on a
// permission the manifest never declared fails there. Names the file.
export function undeclaredPermissionInBuild(use: {
  api: string
  location: string
  tabField?: string
  activeTabDeclared: boolean
  outcome: string
  shadow?: ShadowedDeclaration
}) {
  const {api, location, tabField, activeTabDeclared, outcome} = use
  const {lead, fixKey} = undeclaredPermissionWording(api, use.shadow)

  if (api !== 'tabs') {
    return (
      `${lead}${location} uses chrome.${api}. Nothing grants it here, so ` +
      `${outcome} Add "${api}" to ${fixKey} in manifest.json.`
    )
  }

  const reads = tabField
    ? `reads the ${tabField} of a tab, which "tabs" gates`
    : 'uses chrome.tabs'

  // The plain advice names no key, and a replaced list needs the one to edit.
  const toShadowKey = use.shadow ? ` to ${fixKey}` : ''

  if (activeTabDeclared) {
    return (
      `${lead}${location} ${reads}. "activeTab" is declared, and it ` +
      `grants url, title and favIconUrl for the tab the person invoked ` +
      `the extension on (toolbar click, shortcut, context menu) and ` +
      `captureVisibleTab of that tab. A read of any other tab comes ` +
      `back without those fields. Add "tabs"${toShadowKey} only if the code reads ` +
      `tabs the person did not invoke it on.`
    )
  }

  return (
    `${lead}${location} ${reads}. Nothing grants it here, so ` +
    `${outcome} Add "tabs" to ${fixKey} in manifest.json ` +
    `(Chrome then shows "Read your browsing history" at install), ` +
    `or drop the read. tabs.create, update, remove and sendMessage ` +
    `need no permission.`
  )
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

export function fatalManifestShapeFixed(
  field: string,
  detail: string,
  refusedBy = 'Chrome'
) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} Repaired the ${colors.blue(field)} field, which ${refusedBy} refuses to load the extension over.`
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

export function themeArraysRefused(
  browser: string,
  issues: Array<{field: string; value: string; write: string}>
) {
  const lines: string[] = []
  lines.push(
    `${colors.blue(browserDisplayName(browser))} loads ${colors.yellow('theme.colors')} and ${colors.yellow('theme.tints')} only as number arrays, and the build cannot translate these values from your ${colors.yellow('manifest.json')} exactly:`
  )

  for (const issue of issues) {
    lines.push(
      `  ${colors.yellow(issue.field)} ${issue.value}, write ${issue.write}`
    )
  }

  lines.push(
    `A color is [R, G, B] with whole numbers from 0 to 255, plus an optional alpha from 0 to 1 as a fourth member. A tint is three numbers, [H, S, L].`
  )

  lines.push(
    `The browser refuses the whole extension over one such value, so the build stops here.`
  )

  return lines.join('\n')
}

export function themeColorsTranslated(
  browser: string,
  translated: Array<{key: string; rgb: number[]}>
) {
  const keys = translated
    .map(({key}) => colors.yellow(`theme.colors.${key}`))
    .join(', ')
  const [first] = translated

  return (
    `${prefix('info')} The build wrote ${keys} as [R, G, B] arrays for ${colors.blue(browserDisplayName(browser))}, which loads theme colors only as number arrays. ` +
    `Each array holds the exact color of the string in the source.\n` +
    `Write the arrays in ${colors.yellow('manifest.json')}, ${colors.yellow(first.key)} as ${formatThemeArray(first.rgb)} for one, to state the Chromium colors in the source. Firefox reads the same arrays.`
  )
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
    `The extension's owner declares what the extension collects. The build proposes no value.`
  )

  lines.push(
    `See ${colors.underline('https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/')} for the accepted values.`
  )

  return lines.join('\n')
}

export function missingGeckoAddonId(declared: unknown) {
  const lines: string[] = []
  const field = colors.blue('browser_specific_settings.gecko.id')

  lines.push(
    declared == null
      ? `${prefix('warn')} The manifest sets no ${field}, so Firefox has no add-on ID for this extension.`
      : `${prefix('warn')} Firefox refuses the add-on ID ${colors.yellow(JSON.stringify(declared))} in ${field}, so this extension has none.`
  )

  lines.push(
    `Without one, Firefox gives the add-on a new ID on each launch, so its storage does not survive a relaunch, and addons.mozilla.org assigns one on the first upload that every later upload must carry.`
  )

  lines.push(
    `Set ${colors.yellow('firefox:browser_specific_settings.gecko.id')} in ${colors.yellow('manifest.json')} to an email-like string such as ${colors.yellow('my-extension@example.com')}.`
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

// Both engine families read // comments in an unpacked manifest, and the
// stores refuse them, so the built file never carries one.
export function manifestCommentsRemoved() {
  return (
    `${prefix('info')} Removed the comments from the built ${colors.blue('manifest.json')}, because the stores refuse a manifest that has them.\n` +
    `Your source file keeps them.`
  )
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

export function manifestOverridesSummary(overrideKeys: number) {
  return `${prefix('debug')} manifest overrides keys=${String(overrideKeys)}`
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
      : `The ${target} build resolved ${field} to ${colors.yellow(JSON.stringify(resolved))}, and the build takes only the integer 2 or 3.`
  // Measured: Chromium runs an integer above 3 as Manifest V3 and says
  // nothing, Firefox refuses it. Every other value both of them refuse.
  const aboveThree = Number.isInteger(resolved) && Number(resolved) > 3
  const why =
    resolved === undefined
      ? 'No browser loads a manifest without it, so the build was refused.'
      : !aboveThree
        ? 'No browser loads that value, so the build was refused.'
        : isGeckoBasedBrowser(browser)
          ? 'Firefox does not load a manifest_version above 3, so the build was refused.'
          : 'Chromium loads a version above 3 as Manifest V3 with no warning and Firefox does not load it at all, so the build was refused.'

  return (
    `${prefix('error')} ${lead}\n` +
    `${why} ` +
    `Add a plain ${field}, or scope one to this browser: ${colors.yellow('chromium:manifest_version')} for every Chromium-based browser, ${colors.yellow('firefox:manifest_version')} for Firefox.`
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
      ? `, and added the ${colors.yellow('sidePanel')} permission the panel needs`
      : ''

  return (
    `${prefix('info')} The build folded ${colors.yellow(from)} into ${colors.yellow(to)} for ${colors.blue(browser)}, which reads a sidebar only from ${colors.yellow(to)}${permission}. ` +
    `The panel opens and points at the same compiled page.\n` +
    `Declare both keys to ship a panel of its own per vendor, or scope ${colors.yellow(from)} with a prefix to keep it off this build.`
  )
}

export function geckoServiceWorkerTranslated(browser: string) {
  return (
    `${prefix('info')} The build moved ${colors.yellow('background.service_worker')} into ${colors.yellow('background.scripts')} for ${colors.blue(browser)}, which never starts a service worker. ` +
    `The background runs as an event page from the same compiled script.\n` +
    `Declare ${colors.yellow('scripts')} beside ${colors.yellow('service_worker')}, or a ${colors.yellow('firefox:background')} key, to state the Firefox background in the source.`
  )
}

export function pageKeptAtAuthoredPath(
  fields: string[],
  authored: string,
  outputs: string[],
  mentionedIn: string
) {
  const keys = fields.map((field) => colors.yellow(field)).join(' and ')
  const compiled = outputs
    .map((output) => colors.underline(output))
    .join(' and ')

  return (
    `${prefix('info')} ${keys} ${fields.length > 1 ? 'open' : 'opens'} at ${colors.underline(authored)} in the built manifest, the path written in your source.\n` +
    `${colors.underline(mentionedIn)} holds that path as a string, and from ${compiled} a check against ${colors.blue('sender.url')} or ${colors.blue('location')} would fail.\n` +
    `The compiled page ships at both paths and loads the same script and styles.`
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

export function geckoEmptyBackgroundScriptsDropped(
  browser: string,
  keepsBackground = false
) {
  // A service worker or page beside the list still gives the build a background.
  const outcome = keepsBackground
    ? `The ${colors.blue(browser)} build dropped the empty list and kept the background the manifest declares beside it. `
    : `The ${colors.blue(browser)} build dropped the key, so the add-on runs with no background there too. `

  return (
    `${prefix('warn')} ${colors.yellow('background.scripts')} is an empty list, and Firefox still starts an empty background page for it where Chrome and Safari start none.\n` +
    outcome +
    `Remove ${colors.yellow('background.scripts')} from ${colors.blue('manifest.json')}, or list a script in it.`
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
    `${runtimeGuardAdvice('sidePanel')} Only the build-time branch drops the call from the Firefox bundle, which is what clears the linter.`
  )

  return lines.join('\n')
}

// The guards the scan accepts, spelled the same for every engine it reads.
function runtimeGuardAdvice(api: string) {
  return `Move the call behind a build-time branch on ${colors.blue('import.meta.env.EXTENSION_PUBLIC_BROWSER')}, guard it with ${colors.yellow(`chrome.${api}?.`)}, or keep it inside an ${colors.yellow(`if (chrome.${api})`)} branch.`
}

// Safari ships no counterpart for these namespaces, so the member read itself
// throws and the background dies before it can report anything.
function safariUnsupportedApi(file: string, api: string, detail: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.underline(file)} calls chrome.${api}, which Safari does not have.`
  )

  lines.push(detail)
  lines.push(runtimeGuardAdvice(api))

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
    `Safari has ${colors.blue(`chrome.${api}`)} itself, so a guard on the namespace does not help. Move the call behind a build-time branch on ${colors.blue('import.meta.env.EXTENSION_PUBLIC_BROWSER')}, guard it with ${colors.yellow(guard)}, or keep it inside an ${colors.yellow(`if (chrome.${api}.${member})`)} branch.`
  )

  return lines.join('\n')
}

// Firefox declares these methods promise only in its own schemas, so the
// extra argument fails its argument check before the call does anything.
export function geckoCallbackFormUnsupported(
  file: string,
  api: string,
  member: string
) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.underline(file)} passes a callback to chrome.${api}.${member}, which Firefox takes in promise form only.`
  )

  lines.push(
    `Firefox throws "Incorrect argument types for ${api}.${member}" on that call, where Chrome runs the callback.`
  )

  lines.push(
    `Drop the callback and await ${colors.yellow(`browser.${api}.${member}`)}, which returns a promise on Firefox.`
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

// Edge caps its embedded settings dialog and never sizes it from the page,
// so the one remedy is a tab on Edge only, which the browser prefix gives.
export function edgeEmbeddedOptionsDialog() {
  return (
    `${prefix('warn')} Edge shows an embedded settings page in a dialog at most 400px wide (368px for the page), so a wider settings page is clipped on Edge.\n` +
    `Add ${colors.yellow('edge:options_ui')} with ${colors.yellow('"open_in_tab": true')} to open settings in a tab on Edge only.`
  )
}

// A browser that skips icon_variants shows other icons, and the author
// should learn which ones from the build, not from a dark toolbar.
export function iconVariantsFallback(
  reader: 'gecko' | 'chromium' | 'webkit',
  verdicts: Array<{key: string; outcome: 'kept' | 'added' | 'missing'}>
) {
  const key = colors.yellow('icon_variants')
  const reasons = {
    gecko: `Firefox does not read ${key} yet`,
    chromium: `Chromium reads ${key} only with its ${colors.yellow('ExtensionIconVariants')} flag on`,
    webkit: `Safari draws the light group of ${key} on its toolbar and does not switch to the dark group`
  }
  const browsers = {gecko: 'Firefox', chromium: 'Chromium', webkit: 'Safari'}
  const why = reasons[reader]
  const browser = browsers[reader]
  const named = (outcome: string) =>
    verdicts
      .filter((verdict) => verdict.outcome === outcome)
      .map((verdict) => colors.yellow(verdict.key))
      .join(' and ')

  const kept = named('kept')
  const added = named('added')
  const missing = named('missing')
  const lines: string[] = []

  if (kept && reader === 'webkit') {
    // Measured on Safari 27: the toolbar reads the key and the converter
    // does not, so the app icon is the part that comes from icons.
    lines.push(
      `Apple's app converter does not read the key, so it takes ${kept} from your manifest.`
    )
  } else if (kept) {
    lines.push(`${browser} shows ${kept} from your manifest instead.`)
  }

  if (added) {
    lines.push(
      `The manifest had no ${added}, so the build filled it from the variant that fits every color scheme, or the light one.`
    )
  }

  if (missing) {
    lines.push(
      `No variant can stand in for ${missing}, so ${browser} shows its default icon. Add ${missing} with PNG files to the manifest.`
    )
  }

  const level = added || missing ? 'warn' : 'info'

  return `${prefix(level)} ${why}.\n${lines.join('\n')}`
}

// Safari inherits chromium: keys by design, so a dropped key would otherwise
// vanish with no trace and the user would debug a feature that never loaded.
// One key is one sentence that names it. More keys are one block whose
// continuation lines carry the same bar the Compatibility reporter uses, so a
// reader keeping or dropping prefixed lines keeps or drops the whole verdict
// with its subject, never a bare "Every key above" pointing at another build.
export function webkitUnsupportedKeysDropped(
  browser: string,
  dropped: Array<{path: string; reason: string}>
) {
  return unsupportedKeysDropped('Safari', 'app', 'safari:', browser, dropped)
}

// Firefox ignores a permission string it does not know, and the only other
// voice for it is addons-linter, which a slow run never gets to raise.
export function geckoUnsupportedKeysDropped(
  browser: string,
  dropped: Array<{path: string; reason: string}>
) {
  return unsupportedKeysDropped(
    'Firefox',
    'extension',
    'firefox:',
    browser,
    dropped
  )
}

// One rule for every engine: a key the browser ignores is dropped and named.
function unsupportedKeysDropped(
  engine: string,
  product: string,
  vendorPrefix: string,
  browser: string,
  dropped: Array<{path: string; reason: string}>
) {
  const count = dropped.length
  const target = colors.blue(browser)
  const replacement = `Declare a ${engine}-only replacement with the ${colors.yellow(vendorPrefix)} prefix if you have one.`

  if (count === 1) {
    const [entry] = dropped

    return (
      `${prefix('warn')} ${engine} has no support for ${colors.yellow(entry.path)} (${entry.reason}), ` +
      `so the ${target} build dropped it, and nothing the ${product} could have run was lost. ${replacement}`
    )
  }

  const bar = `${colors.gray('│')}  `
  const lines: string[] = [
    `${prefix('warn')} ${engine} has no support for ${String(count)} manifest keys this project declares, so the ${target} build dropped them:`
  ]

  for (const entry of dropped) {
    lines.push(
      `${bar}${colors.yellow(entry.path)} ${colors.gray(entry.reason)}`
    )
  }

  lines.push(
    `${bar}These ${String(count)} keys are inert on ${engine}, so the built ${product} lost nothing it could have run. ${replacement}`
  )

  return lines.join('\n')
}

// The value is kept because Firefox acts on it: dropping the key would turn
// a build that stays out of private windows into one that runs in them.
export function geckoIncognitoSplitNotAllowed(browser: string) {
  return (
    `${prefix('warn')} Firefox has no split mode, so it reads ${colors.yellow('incognito: "split"')} as ${colors.yellow('"not_allowed"')} and the ${colors.blue(browser)} build never runs in private windows. ` +
    `The build kept the value as declared. Set ${colors.yellow('firefox:incognito')} to ${colors.yellow('"spanning"')} or ${colors.yellow('"not_allowed"')} to choose.`
  )
}

// A description that passes a Chrome build is exactly the one Apple refuses,
// since Chrome allows 132 characters and App Store Connect 112.
export function hostPermissionPatternsIgnored(
  hits: Array<{key: string; pattern: string}>
) {
  return [
    `${prefix('warn')} manifest.json lists host permission patterns the browser drops, so they grant no host access.`,
    ...hits.map(
      (hit) =>
        `${colors.gray('PATTERN')} ${colors.red(hit.pattern)} in ${colors.blue(hit.key)}`
    ),
    'Chrome and Firefox load the extension, Chrome records no error or warning for it, and the other patterns in the list still apply.',
    `Write the host as ${colors.blue('*')}, ${colors.blue('*.domain.tld')} or a literal host.`
  ].join('\n')
}

export function manifestDescriptionOverStoreLimit(
  browser: string,
  length: number,
  limit: number,
  store: string
) {
  const apple = limit === 112 ? ' (Apple error 90849)' : ''

  return [
    `${prefix('warn')} manifest.json ${colors.blue('description')} runs ${length} characters, and ${store} refuses a ${browser} build whose description is over ${limit}${apple}.`,
    `${colors.gray('LIMIT')} ${limit} characters, ${colors.gray('GOT')} ${length}`,
    `Shorten it to ${limit} characters or fewer, the store reads this field from the manifest.`
  ].join('\n')
}

const hostGatedOutcomeOnChromium: Record<string, string> = {
  scripting: 'scripting.executeScript rejects',
  cookies: 'cookies.getAll comes back empty',
  webRequest: 'webRequest events never fire'
}

// Chromium keeps a content script match apart from host access, so a build
// that works on Firefox finds no host for these permissions on Chrome.
export function contentScriptMatchesGrantNoHostOnChromium(
  permissions: readonly string[],
  matches: readonly string[],
  replacedHosts?: ShadowedDeclaration
) {
  const names = permissions
    .map((permission) => colors.yellow(`"${permission}"`))
    .join(', ')
  const outcomes = permissions
    .map((permission) => hostGatedOutcomeOnChromium[permission])
    .filter(Boolean)
    .join(', ')

  // An empty prefixed list took the place of the hosts the plain key names.
  const head = replacedHosts
    ? `manifest.json declares ${names} and lists hosts under ${colors.blue(replacedHosts.listedUnder)}, but ${colors.yellow(replacedHosts.readKey)} replaces that key in the ${replacedHosts.browser} build and names none. A prefixed key replaces the unprefixed one for that browser and does not merge with it, and Chromium takes no host from ${colors.blue('content_scripts')} matches.`
    : `manifest.json declares ${names} and no host permission, and Chromium takes none from ${colors.blue('content_scripts')} matches.`
  const fix = replacedHosts
    ? `Add the hosts to ${colors.yellow(replacedHosts.readKey)}, or remove that key so the build reads ${colors.blue(replacedHosts.listedUnder)}.`
    : `Add the hosts to ${colors.blue('host_permissions')}, or to ${colors.yellow('chromium:host_permissions')} to keep them out of the other builds.`

  return [
    `${prefix('warn')} ${head}`,
    `${colors.gray('MATCHES')} ${matches.join(', ')}`,
    `The content script still runs on those pages, but on Chrome the permission reaches none of them: ${outcomes}. Firefox reads the same matches as host access, so this works on Firefox and not on Chrome.`,
    fix
  ].join('\n')
}

export function manifestDescriptionMissingForStore(
  browser: string,
  store: string,
  limit: number
) {
  return [
    `${prefix('warn')} manifest.json has no ${colors.blue('description')}, and ${store} refuses a ${browser} build without one (Apple error 90849).`,
    `Add a description of ${limit} characters or fewer.`
  ].join('\n')
}

// The browser refuses to compile a module the pages policy does not allow,
// and nothing in the build output says so until the page stays blank.
export function webAssemblyPolicyMissing(
  browser: string,
  files: readonly string[],
  field: string,
  policy: string,
  hasPolicy: boolean
) {
  const fix = hasPolicy
    ? `Add ${colors.yellow("'wasm-unsafe-eval'")} to the script-src of ${colors.blue(field)} in manifest.json, for example:`
    : `Add ${colors.blue(field)} to manifest.json with this value:`

  return [
    `${prefix('warn')} The build emits WebAssembly that manifest.json does not allow ${colors.blue(browser)} to run.`,
    ...files.map((file) => `${colors.gray('FILE')} ${colors.underline(file)}`),
    `Extension pages and the background refuse to compile it unless the pages policy lists ${colors.yellow("'wasm-unsafe-eval'")}.`,
    fix,
    `${colors.gray('VALUE')} ${policy}`
  ].join('\n')
}

export function webAssemblyFetchedFromRemote(
  hits: ReadonlyArray<{file: string; address: string}>
) {
  return [
    `${prefix('warn')} The built code fetches WebAssembly from another origin at run time.`,
    ...hits.map(
      (hit) =>
        `${colors.gray('FILE')} ${colors.underline(hit.file)} ${colors.gray('ADDRESS')} ${colors.underline(hit.address)}`
    ),
    'Stores treat a binary loaded from the network as remotely hosted code, and it fails offline.',
    `Ship the binary in the package: import it with ${colors.blue("new URL('./file.wasm', import.meta.url)")} or place it in ${colors.blue('public/')}, then hand the loader that path.`
  ].join('\n')
}

export function manifestNamesExcludedFile(
  relativePath: string,
  browser: string
) {
  return (
    `manifest.json names ${colors.yellow(relativePath)}, and ` +
    `${colors.blue('exclude')} in extension.config.js leaves that file ` +
    `out of the ${colors.blue(browser)} build.\n` +
    'The reference would answer 404, so the build stops here. Scope the ' +
    `manifest key to the browsers that ship the file (a ${colors.yellow('chromium:')}, ` +
    `${colors.yellow('gecko:')} or ${colors.yellow('safari:')} prefix), or remove the file from exclude.`
  )
}
