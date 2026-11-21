// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, WebpackError} from '@rspack/core'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../../../lib/constants'
import {
  type EmittedCompilation,
  emittedFilesOf,
  readEmittedScripts,
  readProjectSource,
  shippableText
} from '../../../lib/emitted-evidence'
import type {DevOptions, Manifest} from '../../../types'
import {scannableSourcePath} from '../../shared/scannable-source-path'
import * as messages from '../messages'
import {
  matchesOutside,
  type Range,
  type WebkitMissingApis,
  webkitGuardedRanges
} from './apply-dev-defaults-lib/webkit-guarded-ranges'

// Namespaces Safari ships on no version, per MDN browser-compat-data and
// Apple's browser-compatibility page, each paired with the warning it earns.
// An API Safari has but implements differently does not belong here, since
// the call still resolves there and the warning would be noise.
const webkitUnsupportedApis = {
  sidePanel: messages.safariSidePanelUnsupported,
  offscreen: messages.safariOffscreenUnsupported,
  tabGroups: messages.safariTabGroupsUnsupported,
  management: messages.safariManagementUnsupported,
  userScripts: messages.safariUserScriptsUnsupported,
  identity: messages.safariIdentityUnsupported,
  notifications: messages.safariNotificationsUnsupported,
  omnibox: messages.safariOmniboxUnsupported,
  bookmarks: messages.safariBookmarksUnsupported,
  history: messages.safariHistoryUnsupported,
  downloads: messages.safariDownloadsUnsupported,
  idle: messages.safariIdleUnsupported
} as const

type WebkitUnsupportedApi = keyof typeof webkitUnsupportedApis

export type GeckoUnsupportedApi = WebkitUnsupportedApi | 'action'

export interface WebkitUnsupportedMember {
  api: string
  member: string
  // call is chrome.ns.member(...), read is chrome.ns.member.something
  kind: 'call' | 'read'
}

// Members Safari lacks while shipping their namespace, taken from
// @mdn/browser-compat-data (webextensions/api, safari version_added false on a
// member whose own namespace Safari has). The namespace resolves, so the throw
// waits one level deeper, on the call or on the read through it.
//
// Three filters keep this list to real hazards. A member Chrome lacks too stays
// out, since a Chromium-first project never writes it, which is why menus.onShown
// and webRequest.filterResponseData are absent: both are Firefox-only. A missing
// constant reads as undefined and never throws, so the declarativeNetRequest
// maximums stay out. And a long-standing basic whose absence looks more like an
// untested compat row than a real gap stays out, tabs.move above all.
export const webkitUnsupportedMembers = [
  {api: 'action', member: 'getUserSettings', kind: 'call'},
  {api: 'action', member: 'getBadgeTextColor', kind: 'call'},
  {api: 'action', member: 'setBadgeTextColor', kind: 'call'},
  {api: 'action', member: 'onUserSettingsChanged', kind: 'read'},
  {api: 'storage', member: 'managed', kind: 'read'},
  {api: 'runtime', member: 'getContexts', kind: 'call'},
  {api: 'runtime', member: 'onSuspend', kind: 'read'},
  {api: 'runtime', member: 'onSuspendCanceled', kind: 'read'},
  {api: 'runtime', member: 'onUpdateAvailable', kind: 'read'},
  {
    api: 'declarativeNetRequest',
    member: 'getAvailableStaticRuleCount',
    kind: 'call'
  },
  {api: 'declarativeNetRequest', member: 'getDisabledRuleIds', kind: 'call'},
  {api: 'declarativeNetRequest', member: 'updateStaticRules', kind: 'call'},
  {api: 'declarativeNetRequest', member: 'testMatchOutcome', kind: 'call'},
  {api: 'declarativeNetRequest', member: 'onRuleMatchedDebug', kind: 'read'},
  {api: 'tabs', member: 'group', kind: 'call'},
  {api: 'tabs', member: 'ungroup', kind: 'call'},
  {api: 'webNavigation', member: 'onCreatedNavigationTarget', kind: 'read'},
  {api: 'webNavigation', member: 'onHistoryStateUpdated', kind: 'read'},
  {api: 'webNavigation', member: 'onReferenceFragmentUpdated', kind: 'read'},
  {api: 'webNavigation', member: 'onTabReplaced', kind: 'read'},
  {api: 'windows', member: 'onBoundsChanged', kind: 'read'}
] as const satisfies readonly WebkitUnsupportedMember[]

export type WebkitMemberApi = (typeof webkitUnsupportedMembers)[number]['api']

export type UnsupportedApiName = GeckoUnsupportedApi | WebkitMemberApi

// A namespace the table above already covers would warn twice on one line, so
// the member pass drops it. The two lists are disjoint by construction, since a
// namespace Safari lacks entirely has no member Safari can be said to ship.
const webkitMemberEntries = webkitUnsupportedMembers.filter(
  (entry) => !(entry.api in webkitUnsupportedApis)
)

const webkitMemberByKey = new Map<string, WebkitUnsupportedMember>(
  webkitUnsupportedMembers.map((entry) => [
    `${entry.api}.${entry.member}`,
    entry
  ])
)

export const webkitMissingApis: WebkitMissingApis = {
  namespaces: new Set(Object.keys(webkitUnsupportedApis)),
  members: new Set(webkitMemberByKey.keys())
}

export interface GeckoPromiseOnlyMethod {
  api: 'action' | 'tabs'
  member: string
  // How many arguments the promise form takes, so one more is a callback
  max: number
  // A lone function argument is a callback too, where the rest are optional
  soleCallback?: boolean
}

// Methods Firefox's own schemas mark "async": true, which takes no callback,
// kept to the ones Chrome has too, since those are what a Chrome project calls.
export const geckoPromiseOnlyMethods = [
  {api: 'action', member: 'setBadgeTextColor', max: 1},
  {api: 'action', member: 'getBadgeTextColor', max: 1},
  {api: 'action', member: 'isEnabled', max: 1, soleCallback: true},
  {api: 'action', member: 'openPopup', max: 1, soleCallback: true},
  {api: 'tabs', member: 'discard', max: 1},
  {api: 'tabs', member: 'ungroup', max: 1}
] as const satisfies readonly GeckoPromiseOnlyMethod[]

const CALL_SCAN_LIMIT = 20000
const CLOSERS: Record<string, string> = {'(': ')', '[': ']', '{': '}'}

// The top-level arguments of the call whose parenthesis opens at `open`, or
// undefined when the text runs out first, which keeps a cut-off call quiet.
export function callArgumentsAt(
  text: string,
  open: number
): string[] | undefined {
  const args: string[] = []
  const stack: string[] = []
  const end = Math.min(text.length, open + CALL_SCAN_LIMIT)
  let start = open + 1

  for (let index = open + 1; index < end; index++) {
    const char = text[index]

    if (char === '"' || char === "'" || char === '`') {
      index++

      while (index < end && text[index] !== char) {
        if (text[index] === '\\') index++

        index++
      }

      continue
    }

    if (char === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index)
      if (newline === -1) return undefined

      index = newline
      continue
    }

    if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      if (close === -1) return undefined

      index = close + 1
      continue
    }

    if (CLOSERS[char]) {
      stack.push(CLOSERS[char])
      continue
    }

    if (char === ',' && !stack.length) {
      args.push(text.slice(start, index).trim())
      start = index + 1
      continue
    }

    if (char !== ')' && char !== ']' && char !== '}') continue

    if (stack.length) {
      if (stack.pop() !== char) return undefined

      continue
    }

    if (char !== ')') return undefined

    args.push(text.slice(start, index).trim())

    return args.filter(Boolean)
  }

  return undefined
}

const FUNCTION_LITERAL_RE =
  /^(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/

// Firefox checks the argument list against the schema before it runs anything,
// so an argument past the promise form throws whatever its value is.
export function usesGeckoCallbackForm(
  source: string,
  entry: GeckoPromiseOnlyMethod
): boolean {
  const callRe = new RegExp(
    `\\b(?:chrome|browser)\\s*\\.\\s*${entry.api}\\s*\\.\\s*${entry.member}\\s*\\(`,
    'g'
  )

  for (const match of source.matchAll(callRe)) {
    const args = callArgumentsAt(source, match.index + match[0].length - 1)
    // A spread hides the count, so that call is left alone.
    if (!args || args.some((arg) => arg.startsWith('...'))) continue

    if (args.length > entry.max) return true

    if (
      entry.soleCallback &&
      args.length === 1 &&
      FUNCTION_LITERAL_RE.test(args[0])
    ) {
      return true
    }
  }

  return false
}

// Both engines ask the runtime question: only an unguarded read through a
// missing namespace throws, so the author's own feature check keeps it quiet.
export type UnsupportedApiEngine = 'gecko' | 'webkit'

export interface GeckoUnsupportedApiUse {
  api: UnsupportedApiName
  // Set only for a member-level hit, where the namespace itself is fine
  member?: string
  // An absolute source path, or the emitted asset name when no project
  // source explains the call (a vendor bundle, for instance).
  file: string
  emitted: boolean
}

// The namespaces addons-linter reports as UNSUPPORTED_API on a Gecko build.
// sidePanel has no Firefox counterpart on any manifest version. action is
// Manifest V3 only, so a Manifest V2 Firefox bundle still needs browserAction.
// Safari has action on both manifest versions, so its list is the table above.
export function geckoUnsupportedApis(
  manifestVersion: unknown,
  engine: UnsupportedApiEngine = 'gecko'
): GeckoUnsupportedApi[] {
  if (engine === 'webkit') {
    return Object.keys(webkitUnsupportedApis) as GeckoUnsupportedApi[]
  }

  return manifestVersion === 2 ? ['sidePanel', 'action'] : ['sidePanel']
}

// The scan reads emitted assets, so WHEN it runs is load bearing. It runs from
// update-manifest at PROCESS_ASSETS_STAGE_SUMMARIZE + 1, while the dev-server
// control bridge prepends its own producer (which reads a Chromium-only
// namespace) to the background asset at PROCESS_ASSETS_STAGE_REPORT + 151.
// The framework's own code is therefore not in the asset yet. Move either stage
// and every Safari dev session warns about the bridge, not about user code.
//
// The browser only throws when the call reads through the missing namespace,
// so optional chaining on it is safe, and so is a call inside a span the
// author's own feature check keeps closed, which the ranges carry.
export function usesGeckoUnsupportedApi(
  source: string,
  api: GeckoUnsupportedApi,
  guarded?: Range[]
): boolean {
  const memberRe = new RegExp(
    `\\b(?:chrome|browser)\\s*\\.\\s*${api}\\s*\\.\\s*[A-Za-z_$]`
  )

  return guarded?.length
    ? matchesOutside(source, memberRe, guarded)
    : memberRe.test(source)
}

// Safari resolves the namespace, so only the deeper access throws. A call kind
// matches when the missing function is really called and a read kind when
// something reads through the missing event or sub-namespace, which leaves a
// typeof test and an if guard quiet on their own.
//
// Optional chaining at the member position is the guard that works here, so
// chrome.action.getUserSettings?.() and chrome.storage.managed?.get stay quiet.
// A guard one level up, chrome.action?.getUserSettings(), does not actually
// protect a missing member, but the webkit rule treats ?. as deliberate and
// stays quiet there too rather than arguing with a defensive author.
export function usesWebkitUnsupportedMember(
  source: string,
  entry: WebkitUnsupportedMember,
  guarded?: Range[]
): boolean {
  const tail = entry.kind === 'call' ? '\\s*\\(' : '\\s*\\.\\s*[A-Za-z_$]'
  const memberRe = new RegExp(
    `\\b(?:chrome|browser)\\s*\\.\\s*${entry.api}\\s*\\.\\s*${entry.member}(?![\\w$])${tail}`
  )

  return guarded?.length
    ? matchesOutside(source, memberRe, guarded)
    : memberRe.test(source)
}

// Parsing is paid once per text and only when a pattern already matched it,
// so a project that never names a missing API never parses anything.
export function guardedRangesOf(
  missing: WebkitMissingApis = webkitMissingApis
): (text: string) => Range[] {
  const known = new Map<string, Range[]>()

  return (text: string) => {
    let ranges = known.get(text)

    if (!ranges) {
      ranges = webkitGuardedRanges(text, missing)
      known.set(text, ranges)
    }

    return ranges
  }
}

interface ScanTarget {
  // api for a namespace, api.member for a member, so the two never share a key
  key: string
  api: UnsupportedApiName
  member?: string
  test(text: string): boolean
}

// Namespaces first so a gecko report keeps its existing order, members after:
// the callback-form methods on gecko, the missing members on webkit.
function scanTargets(
  manifestVersion: unknown,
  engine: UnsupportedApiEngine
): ScanTarget[] {
  const apis = geckoUnsupportedApis(manifestVersion, engine)
  // A check on action closes a branch only where action is really missing.
  const rangesOf = guardedRangesOf(
    engine === 'webkit'
      ? webkitMissingApis
      : {namespaces: new Set(apis), members: new Set()}
  )
  const targets: ScanTarget[] = apis.map((api) => ({
    key: api,
    api,
    test: (text: string) =>
      usesGeckoUnsupportedApi(text, api) &&
      usesGeckoUnsupportedApi(text, api, rangesOf(text))
  }))

  if (engine !== 'webkit') {
    for (const entry of geckoPromiseOnlyMethods) {
      // Manifest V2 has no action on Firefox, and that warning says it all.
      if (apis.includes(entry.api as GeckoUnsupportedApi)) continue

      targets.push({
        key: `${entry.api}.${entry.member}`,
        api: entry.api,
        member: entry.member,
        test: (text: string) => usesGeckoCallbackForm(text, entry)
      })
    }

    return targets
  }

  for (const entry of webkitMemberEntries) {
    targets.push({
      key: `${entry.api}.${entry.member}`,
      api: entry.api,
      member: entry.member,
      test: (text: string) =>
        usesWebkitUnsupportedMember(text, entry) &&
        usesWebkitUnsupportedMember(text, entry, rangesOf(text))
    })
  }

  return targets
}

interface ScannableModule {
  resource?: string
  modules?: Iterable<ScannableModule>
  rootModule?: ScannableModule
}

export interface ScannableCompilation extends EmittedCompilation {
  modules: Iterable<ScannableModule>
}

export function findGeckoUnsupportedApiUses(
  compilation: ScannableCompilation,
  manifestVersion: unknown,
  engine: UnsupportedApiEngine = 'gecko',
  requireEmittedEvidence = false
): GeckoUnsupportedApiUse[] {
  const targets = scanTargets(manifestVersion, engine)
  const emitted = readEmittedScripts(compilation)
  const explained = new Set<string>()
  const uses = new Map<string, GeckoUnsupportedApiUse>()

  // Evidence is a development question, and a development bundle keeps every
  // build-time branch, so the raw asset still spells a call the browser
  // constant folded away. The script is compressed once, and only when its
  // raw text names a target, so a clean project pays nothing for it.
  const shipped = new Map<string, string>()

  const shippedText = (file: string): string | undefined => {
    if (shipped.has(file)) return shipped.get(file)

    const text = emitted.get(file)
    if (text === undefined) return undefined

    const compressed = requireEmittedEvidence ? shippableText(text) : text
    shipped.set(file, compressed)

    return compressed
  }

  const carries = (file: string, target: ScanTarget): boolean => {
    const raw = emitted.get(file)
    if (raw === undefined || !target.test(raw)) return false

    const text = shippedText(file)

    return text !== undefined && target.test(text)
  }

  for (const outer of compilation.modules) {
    const inner = outer.modules ? [...outer.modules] : [outer]

    for (const module of inner) {
      const resource = scannableSourcePath(module.resource)
      if (!resource) continue

      const source = readProjectSource(resource, compilation)
      if (source === undefined) continue

      for (const target of targets) {
        const key = `${target.key}\0${resource}`
        if (uses.has(key) || !target.test(source)) continue

        const files = emittedFilesOf(compilation, outer)

        if (files) {
          const carrying = files.filter((file) => carries(file, target))
          // The bundler dropped the call, so the linter never sees it.
          if (!carrying.length) continue

          for (const file of carrying) explained.add(`${target.key}\0${file}`)
        } else if (requireEmittedEvidence) {
          // Nothing ties this module to a script the build wrote, so whether
          // the call ships is unproven and warning on it would be a guess.
          continue
        }

        uses.set(key, {
          api: target.api,
          ...(target.member ? {member: target.member} : {}),
          file: resource,
          emitted: false
        })
      }
    }
  }

  // Without a chunk graph nothing ties a script to its source, so the
  // source scan above is the whole report and this pass would repeat it.
  if (!compilation.chunkGraph) return [...uses.values()]

  for (const name of emitted.keys()) {
    for (const target of targets) {
      const key = `${target.key}\0${name}`
      if (explained.has(key) || !carries(name, target)) continue

      uses.set(key, {
        api: target.api,
        ...(target.member ? {member: target.member} : {}),
        file: name,
        emitted: true
      })
    }
  }

  return [...uses.values()]
}

// The module graph names a file by its real path while the project path
// may go through a symlink, so a label is tried against both spellings.
export function relativeToProject(projectPath: string, file: string): string {
  const candidates = [projectPath]

  try {
    candidates.push(fs.realpathSync(projectPath))
  } catch {
    // Ignore
  }

  for (const base of candidates) {
    const relative = path.relative(base, file)
    if (relative && !relative.startsWith('..')) return relative
  }

  return path.relative(projectPath, file) || file
}

// Warn-only. Gecko stays production-only: its warning is lint-shaped, and a
// development bundle keeps every build-time branch, so a source scan there
// would name calls that never ship. Safari asks a different question. A call
// the build wrote into the background really runs, throws on the missing
// namespace, and takes the context down with it, which is why a dev session
// warns too, on emitted evidence rather than on source alone.
export function reportGeckoUnsupportedApis(
  compilation: Compilation,
  compiler: Compiler,
  browser: DevOptions['browser'],
  manifest: Manifest,
  projectPath: string,
  reported?: Set<string>
) {
  const engine: UnsupportedApiEngine | undefined = isGeckoBasedBrowser(
    String(browser)
  )
    ? 'gecko'
    : isWebkitBasedBrowser(String(browser))
      ? 'webkit'
      : undefined
  if (!engine) return

  const isProduction = compiler.options.mode === 'production'
  if (!isProduction && engine !== 'webkit') return

  try {
    const uses = findGeckoUnsupportedApiUses(
      compilation as unknown as ScannableCompilation,
      manifest.manifest_version,
      engine,
      !isProduction
    )

    for (const use of uses) {
      const label = use.emitted
        ? use.file
        : relativeToProject(projectPath, use.file)

      // A dev session recompiles on every save. One line per distinct call
      // for the life of one dev process; a production build stays complete.
      if (!isProduction && reported) {
        const signature = `${use.api}.${use.member || ''}\0${label}`
        if (reported.has(signature)) continue

        reported.add(signature)
      }

      // A member hit names a namespace Safari has, so it never reaches the
      // namespace table below and the two can't both speak for one line.
      const callbackForm = engine === 'gecko' && Boolean(use.member)
      const memberEntry =
        use.member && !callbackForm
          ? webkitMemberByKey.get(`${use.api}.${use.member}`)
          : undefined
      // The webkit table is also the webkit API list, so the lookup hits
      // whenever the engine is webkit and the gecko branch stays for gecko.
      const webkitMessage =
        engine === 'webkit' && !memberEntry
          ? webkitUnsupportedApis[use.api as WebkitUnsupportedApi]
          : undefined
      const text = callbackForm
        ? messages.geckoCallbackFormUnsupported(
            label,
            use.api,
            String(use.member)
          )
        : memberEntry
          ? messages.safariMemberUnsupported(
              label,
              memberEntry.api,
              memberEntry.member,
              memberEntry.kind
            )
          : webkitMessage
            ? webkitMessage(label)
            : use.api === 'sidePanel'
              ? messages.geckoSidePanelUnsupported(label)
              : messages.geckoActionUnsupportedOnMv2(label)
      const warn = new WebpackError(text) as Error & {
        file?: string
        name?: string
      }
      warn.name =
        engine === 'webkit'
          ? 'SafariUnsupportedApiWarning'
          : callbackForm
            ? 'GeckoCallbackFormWarning'
            : 'GeckoUnsupportedApiWarning'

      warn.file = label
      compilation.warnings.push(warn)
    }
  } catch {
    // Diagnostics only, never fail the compile over the scan
  }
}
