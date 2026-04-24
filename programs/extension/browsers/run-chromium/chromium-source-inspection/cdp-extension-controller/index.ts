// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import type {Readable, Writable} from 'stream'
import * as messages from '../../../browsers-lib/messages'
import {
  type ContentScriptTargetRule,
  resolveEmittedContentScriptFile,
  urlMatchesAnyContentScriptRule
} from '../../../browsers-lib/content-script-targets'
import {getCanonicalContentScriptEntryName} from '../../../browsers-lib/content-script-contracts'
import {CDPClient, EXTENSION_AUTO_ATTACH_FILTER} from '../cdp-client'
import {deriveExtensionIdFromTargetsHelper} from './derive-id'
import {connectToChromeCdp, connectToChromeCdpViaPipe} from './connect'
import {readManifestInfo} from './ensure'
import {registerAutoEnableLogging} from './logging'

interface ExtensionInfoResult {
  extensionId: string
  name?: string
  version?: string
}

export type ChromiumDeveloperModeStatus = 'enabled' | 'disabled' | 'unknown'

export class CDPExtensionController {
  private readonly outPath: string
  private readonly browser: 'chrome' | 'edge' | 'chromium-based'
  private readonly cdpPort: number
  private readonly profilePath?: string
  private readonly extensionPaths?: string[]
  private readonly pipeIn?: Readable
  private readonly pipeOut?: Writable
  private cdp: CDPClient | null = null
  private extensionId: string | null = null
  private lastRuntimeReinjectionReport: Record<string, unknown> | null = null
  // Persistent content-script registration for future page targets (fresh
  // tabs, page reloads, cross-URL navigation). On each rebuild the reload
  // flow calls registerContentScriptsForFutureNavigations(rules). The
  // controller then keeps these rules in state and watches Target.* /
  // Runtime.executionContextCreated events so that whenever Chrome creates
  // the extension's isolated world on a matching URL we re-evaluate the
  // latest bundle source there. The wrapper's __EXTENSIONJS_DEV_REINJECT__
  // registry dedupes the static-cache-OLD + CDP-evaluated-NEW pair
  private activeContentScriptRules: ContentScriptTargetRule[] = []
  private contentScriptTargetListenerInstalled = false
  private watchedPageSessions = new Map<
    string,
    {targetId: string; url: string}
  >()

  constructor(args: {
    outPath: string
    browser: 'chrome' | 'edge' | 'chromium-based'
    cdpPort: number
    profilePath?: string
    extensionPaths?: string[]
    pipeIn?: Readable
    pipeOut?: Writable
  }) {
    this.outPath = args.outPath
    this.browser = args.browser
    this.cdpPort = args.cdpPort
    this.profilePath = args.profilePath
    this.extensionPaths = args.extensionPaths
    this.pipeIn = args.pipeIn
    this.pipeOut = args.pipeOut
  }

  async connect(): Promise<void> {
    if (this.cdp) return
    await this.connectFreshClient()
  }

  async ensureLoaded(): Promise<ExtensionInfoResult> {
    if (!this.cdp) throw new Error('CDP not connected')

    // Load unpacked extension from output path
    const exists = fs.existsSync(this.outPath)
    if (!exists) throw new Error(`Output path not found: ${this.outPath}`)

    // CDP-first strategy: try Extensions.loadUnpacked (Chrome 126+ with
    // --enable-unsafe-extension-debugging), then fall back to target derivation
    // for older Chrome or when the CDP domain isn't available.
    if (!this.extensionId) {
      try {
        const {loadUnpackedIfNeeded} = await import('./ensure')
        const cdpId = await loadUnpackedIfNeeded(this.cdp, this.outPath)
        if (cdpId) this.extensionId = cdpId
      } catch {
        // Extensions.loadUnpacked not supported — fall through to target derivation
      }
    }

    // Fallback: derive extensionId from Chrome targets (--load-extension path)
    if (!this.extensionId) {
      const id = await this.deriveExtensionIdFromTargets()
      if (id) this.extensionId = id
    }

    if (this.extensionId) {
      const belongsToOutPath = this.extensionIdBelongsToOutPath(
        this.extensionId
      )
      if (belongsToOutPath === false) {
        this.extensionId = null
      }
    }

    // If already known, verify info
    if (this.extensionId) {
      try {
        // Try Extensions domain first; if missing, fall back to manifest
        let info: {
          extensionInfo?: {name?: string; version?: string}
        } | null = null

        try {
          info = await this.cdp.getExtensionInfo(this.extensionId)
        } catch {
          // ignore
        }

        if (!info) {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(this.outPath, 'manifest.json'), 'utf-8')
          )

          return {
            extensionId: this.extensionId,
            name: manifest.name,
            version: manifest.version
          }
        }

        return {
          extensionId: this.extensionId,
          name: info?.extensionInfo?.name,
          version: info?.extensionInfo?.version
        }
      } catch {
        // will reload
      }
    }

    try {
      // If still unknown, derive from targets with a longer wait.
      if (!this.extensionId) {
        this.extensionId = await this.deriveExtensionIdFromTargets(20, 200)
      }

      if (!this.extensionId) {
        throw new Error('Failed to determine extension ID via CDP')
      }

      // After load/derivation, set up runtime/log domains
      await this.enableLogging()

      // Prefer Extensions.getExtensionInfo; fallback to manifest
      let name: string | undefined
      let version: string | undefined

      try {
        const info = await this.cdp.getExtensionInfo(this.extensionId)
        name = info?.extensionInfo?.name
        version = info?.extensionInfo?.version
      } catch (error) {
        try {
          const manifest = readManifestInfo(this.outPath)
          name = String(manifest?.name || '') || undefined
          version = String(manifest?.version || '') || undefined
        } catch (e2: unknown) {
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.warn(
              '[CDP] Fallback manifest read failed:',
              String((e2 as Error)?.message || e2)
            )
          }
        }
      }

      return {extensionId: this.extensionId, name, version}
    } catch (error) {
      throw new Error(
        `Failed to load extension from ${path.resolve(this.outPath)}: ${String(
          (error as Error).message || error
        )}`
      )
    }
  }

  private async deriveExtensionIdFromTargets(
    maxRetries = 20,
    backoffMs = 200
  ): Promise<string | null> {
    if (!this.cdp) return null
    return await deriveExtensionIdFromTargetsHelper(
      this.cdp,
      this.outPath,
      maxRetries,
      backoffMs,
      this.profilePath,
      this.extensionPaths
    )
  }

  private normalizePath(input: string): string {
    try {
      return fs.realpathSync(path.resolve(input))
    } catch {
      return path.resolve(input)
    }
  }

  private extensionIdBelongsToOutPath(extensionId: string): boolean | null {
    if (!this.profilePath || !extensionId) return null

    const prefCandidates: string[] = []
    const addPrefCandidate = (dir: string) => {
      const prefPath = path.join(dir, 'Preferences')
      if (fs.existsSync(prefPath)) prefCandidates.push(prefPath)
    }

    try {
      addPrefCandidate(this.profilePath)
      addPrefCandidate(path.join(this.profilePath, 'Default'))
      for (const entry of fs.readdirSync(this.profilePath)) {
        if (!/^Profile\s+\d+$/i.test(entry)) continue
        addPrefCandidate(path.join(this.profilePath, entry))
      }
    } catch {
      // Ignore profile listing errors.
    }

    if (prefCandidates.length === 0) return null

    const normalizedOutPath = this.normalizePath(this.outPath)
    for (const prefPath of prefCandidates) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'))
        const settings = prefs?.extensions?.settings
        const info = settings?.[extensionId]
        const storedPath = String(info?.path || '')
        if (!storedPath) continue
        return this.normalizePath(storedPath) === normalizedOutPath
      } catch {
        // Ignore malformed preference files.
      }
    }

    return null
  }

  getDeveloperModeStatus(): ChromiumDeveloperModeStatus {
    if (!this.profilePath) return 'unknown'

    const prefCandidates: string[] = []
    const seen = new Set<string>()

    const addPrefCandidate = (dir: string) => {
      const prefPath = path.join(dir, 'Preferences')
      if (!fs.existsSync(prefPath)) return
      const dedupeKey = path.resolve(prefPath)
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      prefCandidates.push(prefPath)
    }

    try {
      addPrefCandidate(this.profilePath)
      addPrefCandidate(path.join(this.profilePath, 'Default'))

      for (const entry of fs.readdirSync(this.profilePath)) {
        if (!/^Profile\s+\d+$/i.test(entry)) continue
        addPrefCandidate(path.join(this.profilePath, entry))
      }
    } catch {
      // Ignore profile listing errors.
    }

    for (const prefPath of prefCandidates) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'))
        const uiFlag = prefs?.extensions?.ui?.developer_mode

        if (typeof uiFlag === 'boolean') {
          return uiFlag ? 'enabled' : 'disabled'
        }

        const legacyFlag = prefs?.extensions?.developer_mode
        if (typeof legacyFlag === 'boolean') {
          return legacyFlag ? 'enabled' : 'disabled'
        }
      } catch {
        // Ignore malformed preference files.
      }
    }

    return 'unknown'
  }

  getLastRuntimeReinjectionReport(): Record<string, unknown> | null {
    return this.lastRuntimeReinjectionReport
  }

  async reloadMatchingTabsForContentScripts(
    rules: ContentScriptTargetRule[],
    options: {
      preferPageReload?: boolean
      allowCoarseCleanup?: boolean
      sourceOverridesByBundleId?: Record<string, string>
    } = {}
  ): Promise<number> {
    if (!this.cdp || rules.length === 0) return 0

    let reinjectedTabs = 0
    const targets = await this.cdp.getTargets()

    for (const target of targets || []) {
      const targetType = String((target as any)?.type || '')
      const targetId = String((target as any)?.targetId || '')
      const targetUrl = String((target as any)?.url || '')

      if (targetType !== 'page' || !targetId || !targetUrl) continue
      const matchingRules = rules.filter((rule) =>
        urlMatchesAnyContentScriptRule(targetUrl, [rule])
      )

      if (matchingRules.length === 0) continue

      try {
        const sessionId = await this.cdp.attachToTarget(targetId)
        let reinjected = false

        if (options.preferPageReload) {
          reinjected = await this.reloadPageTarget(sessionId)
        } else {
          for (const [index, rule] of matchingRules.entries()) {
            const didReinject = await this.reinjectContentScriptRule(
              sessionId,
              rule,
              options.allowCoarseCleanup ?? index === 0,
              options.sourceOverridesByBundleId
            )
            reinjected = reinjected || didReinject
          }

          if (!reinjected) {
            reinjected = await this.reloadPageTarget(sessionId)
          }
        }

        if (reinjected) {
          reinjectedTabs += 1
        }
      } catch (error) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.warn(
            `[CDP] Failed to reinject content scripts into ${targetUrl}: ${String(
              (error as Error)?.message || error
            )}`
          )
        }
      }
    }

    return reinjectedTabs
  }

  /**
   * Install a persistent CDP listener that re-injects the latest content-
   * script bundle into any page that navigates to a URL matching a rule —
   * including fresh tabs, full page reloads, and same-tab URL changes.
   *
   * Chrome binds its static `content_scripts` list to the bytes it read when
   * the extension was loaded, and those cached bytes don't change when
   * Rspack rewrites the hashed bundle on edit. We can't reload the extension
   * without losing SW state and closing popup/sidebar. So for every matching
   * navigation we wait for Chrome to create the extension's isolated world
   * (which happens at `document_start` just before the cached content script
   * runs) and evaluate the fresh bundle source in that exact world. The
   * wrapper's `__EXTENSIONJS_DEV_REINJECT__` registry keyed on the canonical
   * bundle id unmounts the stale generation before mounting the new one, so
   * what the user sees is the latest build.
   *
   * Called on every `content-scripts` reload instruction with the latest
   * rules. Safe to call repeatedly — rules are simply replaced.
   */
  async registerContentScriptsForFutureNavigations(
    rules: ContentScriptTargetRule[]
  ): Promise<void> {
    this.activeContentScriptRules = [...rules]
    if (!this.cdp) return

    if (!this.contentScriptTargetListenerInstalled) {
      this.contentScriptTargetListenerInstalled = true
      this.installContentScriptTargetListener()
    }

    // Proactively attach to page targets that already match so their next
    // navigation (or an in-flight one) is covered without waiting for a
    // `targetInfoChanged` event.
    try {
      const targets = await this.cdp.getTargets()
      for (const target of targets || []) {
        if (String((target as any)?.type || '') !== 'page') continue
        const targetId = String((target as any)?.targetId || '')
        const url = String((target as any)?.url || '')
        if (!targetId || !url) continue
        if (!this.urlMatchesAnyActiveRule(url)) continue
        await this.ensureWatchedPageSession(targetId, url)
      }
    } catch {
      // Best-effort pre-attach; the listener handles future targets.
    }
  }

  private installContentScriptTargetListener(): void {
    if (!this.cdp) return
    this.cdp.onProtocolEvent((raw: Record<string, unknown>) => {
      const method = String((raw as {method?: string}).method || '')
      const params = (raw as {params?: any}).params
      const sessionId = String((raw as {sessionId?: string}).sessionId || '')

      if (
        method === 'Target.targetCreated' ||
        method === 'Target.targetInfoChanged'
      ) {
        const targetInfo = params?.targetInfo
        if (!targetInfo || targetInfo.type !== 'page') return
        const targetId = String(targetInfo.targetId || '')
        const url = String(targetInfo.url || '')
        if (!targetId) return
        if (!this.urlMatchesAnyActiveRule(url)) {
          // Update URL for tracked session so a future context created on a
          // now-non-matching URL is skipped.
          for (const info of this.watchedPageSessions.values()) {
            if (info.targetId === targetId) info.url = url
          }
          return
        }
        this.ensureWatchedPageSession(targetId, url).catch(() => {
          // Target may have closed mid-flight; ignore.
        })
        return
      }

      if (method === 'Runtime.executionContextCreated') {
        if (!sessionId) return
        const session = this.watchedPageSessions.get(sessionId)
        if (!session) return
        const context = params?.context
        if (!context) return
        this.evaluateContentScriptOnNewContext(
          sessionId,
          session,
          context
        ).catch(() => {
          // Best-effort; next navigation will re-try.
        })
        return
      }

      if (method === 'Target.detachedFromTarget') {
        if (sessionId) this.watchedPageSessions.delete(sessionId)
      }
    })
  }

  private urlMatchesAnyActiveRule(url: string): boolean {
    if (!url || this.activeContentScriptRules.length === 0) return false
    return this.activeContentScriptRules.some((rule) =>
      urlMatchesAnyContentScriptRule(url, [rule])
    )
  }

  private async ensureWatchedPageSession(
    targetId: string,
    url: string
  ): Promise<void> {
    if (!this.cdp) return
    // Already attached to this target? Update URL and bail.
    for (const info of this.watchedPageSessions.values()) {
      if (info.targetId === targetId) {
        info.url = url
        return
      }
    }

    let sessionId: string
    try {
      sessionId = await this.cdp.attachToTarget(targetId)
    } catch {
      return
    }
    this.watchedPageSessions.set(sessionId, {targetId, url})
    try {
      await this.cdp.sendCommand('Runtime.enable', {}, sessionId)
    } catch {
      // If Runtime.enable fails the session is likely stale; clean up.
      this.watchedPageSessions.delete(sessionId)
    }
  }

  private async evaluateContentScriptOnNewContext(
    sessionId: string,
    session: {targetId: string; url: string},
    context: {
      id?: number
      origin?: string
      auxData?: {type?: string; isDefault?: boolean; frameId?: string}
    }
  ): Promise<void> {
    if (!this.cdp) return
    const contextId = context.id
    if (typeof contextId !== 'number') return
    if (!this.urlMatchesAnyActiveRule(session.url)) return

    const auxData = context.auxData || {}
    const origin = String(context.origin || '')
    const extensionId =
      this.extensionId || (await this.deriveExtensionIdFromTargets())
    const extensionOrigin = extensionId
      ? `chrome-extension://${extensionId}`
      : ''

    // Find rules that match this URL AND target the world of this context.
    const matchingRules = this.activeContentScriptRules.filter((rule) => {
      if (!urlMatchesAnyContentScriptRule(session.url, [rule])) return false
      if (rule.world === 'main') {
        return auxData.type === 'default' && auxData.isDefault === true
      }
      return auxData.type === 'isolated' && origin === extensionOrigin
    })

    if (matchingRules.length === 0) return

    for (const rule of matchingRules) {
      const bundlePath = resolveEmittedContentScriptFile(
        this.outPath,
        rule.index,
        'js'
      )
      if (!bundlePath || !fs.existsSync(bundlePath)) continue
      const source = this.patchReinjectSourceForInvalidatedRuntime(
        fs.readFileSync(bundlePath, 'utf-8')
      )
      if (!source.trim()) continue
      const bundleId = getCanonicalContentScriptEntryName(rule.index)
      // allowCoarseCleanup=true: fresh navigation, nothing to preserve.
      const expression = this.buildReinjectExpression(bundleId, source, true)
      try {
        await this.cdp.evaluateInContext(sessionId, expression, contextId)
      } catch {
        // Best-effort; ignore per-rule failures.
      }
    }
  }

  async reinjectMatchingTabsViaExtensionRuntime(
    rules: ContentScriptTargetRule[]
  ): Promise<number> {
    if (!this.cdp || rules.length === 0) {
      this.lastRuntimeReinjectionReport = {
        phase: 'skipped',
        reason: 'missing_cdp_or_rules',
        hasCdp: !!this.cdp,
        ruleCount: rules.length
      }
      return 0
    }

    const targets = await this.cdp.getTargets()
    const matchingUrlsByRule = new Map<number, Set<string>>()

    for (const target of targets || []) {
      const targetType = String((target as any)?.type || '')
      const targetUrl = String((target as any)?.url || '')
      if (targetType !== 'page' || !targetUrl) continue

      for (const rule of rules) {
        if (!urlMatchesAnyContentScriptRule(targetUrl, [rule])) continue
        const urls = matchingUrlsByRule.get(rule.index) || new Set<string>()
        urls.add(targetUrl)
        matchingUrlsByRule.set(rule.index, urls)
      }
    }

    const payload = rules
      .map((rule) => {
        const jsPath = resolveEmittedContentScriptFile(
          this.outPath,
          rule.index,
          'js'
        )
        const cssPath = resolveEmittedContentScriptFile(
          this.outPath,
          rule.index,
          'css'
        )
        if (!jsPath || !fs.existsSync(jsPath)) return null
        const jsFile = path.relative(this.outPath, jsPath).replace(/\\/g, '/')
        const cssFile =
          cssPath && fs.existsSync(cssPath)
            ? path.relative(this.outPath, cssPath).replace(/\\/g, '/')
            : null
        const jsSource = fs.readFileSync(jsPath, 'utf-8')
        const buildTokenMatch = jsSource.match(
          /__EXTENSIONJS_REINJECT_BUILD_TOKEN\s*=\s*"([^"]+)"/
        )
        const proofMatch =
          jsSource.match(
            /extjs-chromium-live-content-css-modules:script-primary-\d+/
          ) || jsSource.match(/Live Update Proof [A-Za-z0-9_-]+/)

        return {
          index: rule.index,
          world: rule.world,
          matches: [...rule.matches],
          urls: Array.from(matchingUrlsByRule.get(rule.index) || []).sort(),
          jsFile,
          cssFile,
          buildToken: buildTokenMatch?.[1] || null,
          proofMarker: proofMatch?.[0] || null
        }
      })
      .filter(
        (
          entry
        ): entry is {
          index: number
          world: 'extension' | 'main'
          matches: string[]
          urls: string[]
          jsFile: string
          cssFile: string | null
          buildToken: string | null
          proofMarker: string | null
        } => !!entry && entry.urls.length > 0
      )

    if (payload.length === 0) {
      this.lastRuntimeReinjectionReport = {
        phase: 'skipped',
        reason: 'no_payload',
        ruleCount: rules.length
      }
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log('[CDP] extension-runtime reinjection skipped: no payload')
      }
      return 0
    }

    const runtimeTarget = await this.attachToExtensionRuntimeTarget()
    if (!runtimeTarget) {
      const targetSummary = (targets || [])
        .map((target) => ({
          type: String((target as any)?.type || ''),
          url: String((target as any)?.url || '')
        }))
        .filter((entry) => entry.type || entry.url)
      this.lastRuntimeReinjectionReport = {
        phase: 'unavailable',
        reason: 'no_runtime_target',
        extensionId: this.extensionId,
        targets: targetSummary
      }
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `[CDP] extension-runtime reinjection unavailable: ${JSON.stringify({
            extensionId: this.extensionId,
            targets: targetSummary
          })}`
        )
      }
      return 0
    }

    const result = await this.cdp.evaluate(
      runtimeTarget.sessionId,
      `(() => (async () => {
        const payload = ${JSON.stringify(payload)};
        const chromeRuntime =
          typeof globalThis === 'object' && globalThis && globalThis.chrome
            ? globalThis.chrome
            : null;
        const runtimeChrome =
          chromeRuntime &&
          chromeRuntime.scripting &&
          chromeRuntime.tabs
            ? chromeRuntime
            : null;
        if (!runtimeChrome) {
          return {
            reinjectedTabs: 0,
            hasRuntime: false,
            hasChrome: !!chromeRuntime,
            hasScripting: !!(chromeRuntime && chromeRuntime.scripting),
            hasTabs: !!(chromeRuntime && chromeRuntime.tabs),
            entries: payload.length,
            matches: []
          };
        }
        let reinjectedTabs = 0;
        const matches = [];
        for (const entry of payload) {
          const queriedTabs = await runtimeChrome.tabs.query(
            entry.matches.length > 0 ? { url: entry.matches } : {}
          );
          const matchingTabs = queriedTabs.filter((tab) => {
            if (!tab || typeof tab.id !== 'number') return false;
            if (typeof tab.url !== 'string' || !tab.url) return true;
            return entry.urls.length === 0 || entry.urls.includes(tab.url);
          });
          matches.push({
            index: entry.index,
            queriedTabs: queriedTabs.length,
            matchingTabs: matchingTabs.length
          });
          for (const tab of matchingTabs) {
            const target = { tabId: tab.id, allFrames: false };
            if (entry.cssFile) {
              try {
                await runtimeChrome.scripting.insertCSS({
                  target,
                  files: [entry.cssFile]
                });
              } catch (error) {}
            }
            await runtimeChrome.scripting.executeScript({
              target,
              files: [entry.jsFile],
              world: entry.world === 'main' ? 'MAIN' : 'ISOLATED'
            });
            reinjectedTabs += 1;
          }
        }
        return {
          reinjectedTabs,
          hasRuntime: true,
          entries: payload.length,
          matches
        };
      })())()`,
      {awaitPromise: true}
    )

    this.lastRuntimeReinjectionReport = {
      phase: 'evaluated',
      targetType: runtimeTarget.targetType,
      targetUrl: runtimeTarget.targetUrl,
      result:
        result && typeof result === 'object'
          ? JSON.parse(JSON.stringify(result))
          : result
    }

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `[CDP] extension-runtime reinjection result: ${JSON.stringify({
          targetType: runtimeTarget.targetType,
          targetUrl: runtimeTarget.targetUrl,
          result
        })}`
      )
    }

    if (typeof result === 'number') return result
    if (result && typeof result === 'object') {
      const reinjectedTabs = Number((result as any).reinjectedTabs)
      return Number.isFinite(reinjectedTabs) ? reinjectedTabs : 0
    }
    return 0
  }

  private async reloadPageTarget(sessionId: string): Promise<boolean> {
    if (!this.cdp) return false

    try {
      await this.cdp.sendCommand(
        'Page.reload',
        {
          ignoreCache: true
        },
        sessionId
      )
      return true
    } catch {
      return false
    }
  }

  async hardReload(): Promise<boolean> {
    if (!this.extensionId) return false

    try {
      if (!this.cdp) {
        await this.connectFreshClient()
      }

      if (this.cdp && (await this.cdp.forceReloadExtension(this.extensionId))) {
        return true
      }
    } catch {
      // Retry once with a fresh CDP session below.
    }

    try {
      await this.reconnectForReload()
      return Boolean(
        this.cdp &&
          this.extensionId &&
          (await this.cdp.forceReloadExtension(this.extensionId))
      )
    } catch {
      return false
    }
  }

  private async attachToExtensionRuntimeTarget(): Promise<
    | {
        sessionId: string
        targetType: string
        targetUrl: string
      }
    | undefined
  > {
    if (!this.cdp) return undefined
    if (!this.extensionId) {
      this.extensionId = await this.deriveExtensionIdFromTargets(10, 150)
    }
    if (!this.extensionId) return undefined

    const extensionOrigin = `chrome-extension://${this.extensionId}/`

    for (let attempt = 0; attempt < 20; attempt++) {
      const targets = await this.cdp.getTargets()
      const runtimeTargets = (targets || []).filter((target) => {
        const targetType = String((target as any)?.type || '')
        const targetId = String((target as any)?.targetId || '')
        return (
          (targetType === 'service_worker' ||
            targetType === 'background_page' ||
            targetType === 'worker') &&
          !!targetId
        )
      })
      const runtimeTarget =
        runtimeTargets.find((target) =>
          String((target as any)?.url || '').startsWith(extensionOrigin)
        ) ||
        runtimeTargets.find((target) =>
          String((target as any)?.url || '').startsWith('chrome-extension://')
        )

      if (runtimeTarget) {
        try {
          const sessionId = await this.cdp.attachToTarget(
            String((runtimeTarget as any).targetId)
          )
          await this.cdp.sendCommand('Runtime.enable', {}, sessionId)
          return {
            sessionId,
            targetType: String((runtimeTarget as any)?.type || ''),
            targetUrl: String((runtimeTarget as any)?.url || '')
          }
        } catch {
          // Retry on the next pass.
        }
      }

      this.extensionId =
        (await this.deriveExtensionIdFromTargets(4, 100)) || this.extensionId
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    return undefined
  }

  private async connectFreshClient(): Promise<void> {
    // Prefer pipe transport (--remote-debugging-pipe) when available;
    // fall back to WebSocket via --remote-debugging-port.
    if (this.pipeIn && this.pipeOut && !this.pipeIn.destroyed) {
      this.cdp = await connectToChromeCdpViaPipe(
        this.pipeIn,
        this.pipeOut,
        this.cdpPort
      )
    } else {
      this.cdp = await connectToChromeCdp(this.cdpPort)
    }

    // Proactively enable auto-attach and capture extensionId from service worker targets as soon as they appear
    try {
      await this.cdp.sendCommand('Target.setDiscoverTargets', {
        discover: true
      })
      await this.cdp.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: EXTENSION_AUTO_ATTACH_FILTER
      })
    } catch (error: unknown) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn(
          messages.cdpAutoAttachSetupFailed(
            String((error as Error)?.message || error)
          )
        )
      }
    }

    registerAutoEnableLogging(this.cdp, () => this.extensionId)
  }

  private async reconnectForReload(): Promise<void> {
    try {
      this.cdp?.disconnect?.()
    } catch {
      // ignore best-effort cleanup
    }

    this.cdp = null
    await this.connectFreshClient()

    try {
      const derivedExtensionId = await this.deriveExtensionIdFromTargets(
        10,
        150
      )
      if (derivedExtensionId) {
        this.extensionId = derivedExtensionId
      }
    } catch {
      // Keep the previous extension id if re-derivation fails.
    }
  }

  onProtocolEvent(
    cb: (
      evt: {method: string; params?: unknown} & Record<string, unknown>
    ) => void
  ) {
    if (!this.cdp) throw new Error('CDP not connected')

    this.cdp.onProtocolEvent((raw: Record<string, unknown>) => {
      const evt = raw as {method: string; params?: unknown} & Record<
        string,
        unknown
      >
      cb(evt)
    })
  }

  clearProtocolEventHandler() {
    if (!this.cdp) return
  }

  // Stream logs when requested: attach to page + extension targets and forward
  async enableUnifiedLogging() {
    if (!this.cdp) return

    try {
      await this.cdp.enableAutoAttach()
      await this.cdp.enableRuntimeAndLog()

      // Proactively attach to existing targets and enable Runtime/Log per-session
      try {
        const targets = await this.cdp.getTargets()

        for (const t of targets || []) {
          const type = String(t?.type || '')
          if (
            type === 'page' ||
            type === 'service_worker' ||
            type === 'background_page' ||
            type === 'worker'
          ) {
            const targetId = String(t?.targetId || '')
            if (!targetId) continue

            const sessionId = await this.cdp.attachToTarget(targetId)
            await this.cdp.enableRuntimeAndLog(sessionId)
          }
        }
      } catch {
        // ignore
      }
      // Filtering is performed in the caller using event metadata
    } catch {
      // ignore
    }
  }

  async enableRuntimeForSession(sessionId: string): Promise<void> {
    if (!this.cdp) return

    try {
      await this.cdp.enableRuntimeAndLog(sessionId)
    } catch {
      // ignore
    }
  }

  private async enableLogging() {
    if (!this.cdp) return
    try {
      const extId = this.extensionId
      this.onProtocolEvent(async (message: Record<string, unknown>) => {
        try {
          if (!message || !message.method) return

          if (message.method === 'Target.attachedToTarget') {
            const params =
              (message as {params?: Record<string, unknown>}).params || {}
            const targetInfo = (
              params as {targetInfo?: {url?: string; type?: string}}
            ).targetInfo || {url: '', type: ''}
            const sessionId = (params as {sessionId?: string}).sessionId
            const url: string = String(targetInfo.url || '')
            const type: string = String(targetInfo.type || '')
            const matchesExtension = !!(
              (this.extensionId &&
                url.includes(`chrome-extension://${this.extensionId}/`)) ||
              (extId && url.includes(`chrome-extension://${extId}/`)) ||
              type === 'service_worker'
            )

            if (sessionId && matchesExtension) {
              // Enable runtime and log domains for this session
              await this.cdp!.sendCommand('Runtime.enable', {}, sessionId)
              await this.cdp!.sendCommand('Log.enable', {}, sessionId)
            }
          } else if (
            message.method === 'Runtime.consoleAPICalled' ||
            message.method === 'Log.entryAdded'
          ) {
            if (String(process.env.EXTENSION_VERBOSE || '').trim() === '1') {
              const ts = new Date().toISOString()
              console.log(messages.cdpUnifiedExtensionLog(ts, message.params))
            }
          }
        } catch {
          // ignore
        }
      })
    } catch (e) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn('[CDP] enableLogging failed:', String(e))
      }
    }
  }

  // Best-effort info retrieval without throwing
  async getInfoBestEffort(): Promise<ExtensionInfoResult | null> {
    try {
      if (!this.cdp) return null
      if (!this.extensionId) {
        this.extensionId = await this.deriveExtensionIdFromTargets(6, 150)
      }

      if (this.extensionId) {
        const belongsToOutPath = this.extensionIdBelongsToOutPath(
          this.extensionId
        )
        if (belongsToOutPath === false) {
          this.extensionId = await this.deriveExtensionIdFromTargets(10, 150)
        }
      }

      if (!this.extensionId) return null

      let name: string | undefined
      let version: string | undefined

      try {
        const info = await this.cdp.getExtensionInfo(this.extensionId)
        name = info?.extensionInfo?.name
        version = info?.extensionInfo?.version
      } catch {
        try {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(this.outPath, 'manifest.json'), 'utf-8')
          )
          name = manifest?.name
          version = manifest?.version
        } catch {
          // ignore
        }
      }
      return {extensionId: this.extensionId, name, version}
    } catch (error) {
      return null
    }
  }

  private async reinjectContentScriptRule(
    sessionId: string,
    rule: ContentScriptTargetRule,
    allowCoarseCleanup: boolean,
    sourceOverridesByBundleId?: Record<string, string>
  ): Promise<boolean> {
    if (!this.cdp) return false

    const bundleId = getCanonicalContentScriptEntryName(rule.index)
    const bundlePath = resolveEmittedContentScriptFile(
      this.outPath,
      rule.index,
      'js'
    )

    if (!bundlePath || !fs.existsSync(bundlePath)) return false

    const sourceOverride =
      sourceOverridesByBundleId && typeof sourceOverridesByBundleId === 'object'
        ? sourceOverridesByBundleId[bundleId]
        : undefined
    const source = this.patchReinjectSourceForInvalidatedRuntime(
      typeof sourceOverride === 'string'
        ? sourceOverride
        : fs.readFileSync(bundlePath, 'utf-8')
    )
    const buildTokenMatch = source.match(
      /__EXTENSIONJS_REINJECT_BUILD_TOKEN\s*=\s*"([^"]+)"/
    )
    const proofMatch =
      source.match(
        /extjs-chromium-live-content-css-modules:script-primary-\d+/
      ) || source.match(/Live Update Proof [A-Za-z0-9_-]+/)

    if (!source.trim()) return false
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `[CDP] reinject bundle ${bundleId} from ${bundlePath}` +
          `${proofMatch ? ` (${proofMatch[0]})` : ''}` +
          ` build=${buildTokenMatch?.[1] || '<none>'}` +
          ` sourceOverride=${typeof sourceOverride === 'string'}`
      )
    }
    const contextId = await this.resolveExecutionContextId(sessionId, rule)
    if (!contextId) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.warn(
          `[CDP] No execution context found for ${bundleId} (${rule.world})`
        )
      }
      return false
    }

    const result = await this.cdp.evaluateInContext(
      sessionId,
      this.buildReinjectExpression(bundleId, source, allowCoarseCleanup),
      contextId
    )

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `[CDP] reinject result ${bundleId}: ${JSON.stringify(result)}`
      )
    }
    if (result && typeof result === 'object' && 'ok' in result) {
      return (result as {ok?: boolean}).ok !== false
    }

    return true
  }

  private buildReinjectExpression(
    bundleId: string,
    source: string,
    allowCoarseCleanup: boolean
  ): string {
    const annotatedSource = `${source}\n//# sourceURL=extension.js-reinject://${bundleId}.js`
    const extensionBase = this.extensionId
      ? `chrome-extension://${this.extensionId}/`
      : ''
    return `(() => {
  const bundleId = ${JSON.stringify(bundleId)};
  const source = ${JSON.stringify(annotatedSource)};
  const extensionBase = ${JSON.stringify(extensionBase)};
  const rootSelector = '[data-extension-root], #extension-root';
  const keyedSelector = '[data-extjs-reinject-key="${bundleId}"]';
  const registry = (typeof globalThis === 'object' && globalThis)
    ? (globalThis.__EXTENSIONJS_DEV_REINJECT__ || (globalThis.__EXTENSIONJS_DEV_REINJECT__ = {}))
    : {};
  const existing = registry[bundleId];
  const readGeneration = (entry) => {
    try {
      if (!entry) return 0;
      if (typeof entry === 'function' && typeof entry.__extjsGeneration === 'number') {
        return entry.__extjsGeneration;
      }
      if (typeof entry === 'object') {
        if (typeof entry.__extjsGeneration === 'number') return entry.__extjsGeneration;
        if (typeof entry.generation === 'number') return entry.generation;
        if (typeof entry.cleanup === 'function' && typeof entry.cleanup.__extjsGeneration === 'number') {
          return entry.cleanup.__extjsGeneration;
        }
      }
    } catch (error) {}
    return 0;
  };
  const previousGeneration = readGeneration(existing);
  try {
    if (typeof existing === 'function') existing();
    if (existing && typeof existing.cleanup === 'function') existing.cleanup();
  } catch (error) {}
  if (${allowCoarseCleanup ? 'true' : 'false'}) {
    try {
      const staleRoots = Array.from(document.querySelectorAll(rootSelector));
      for (const root of staleRoots) {
        if (root && typeof root.remove === 'function') root.remove();
      }
    } catch (error) {}
  }
  const trackedNodes = new Set();
  const trackNode = (node) => {
    try {
      if (!node || typeof Element !== 'function' || !(node instanceof Element)) return;
      const matchesRoot = typeof node.matches === 'function' && node.matches(rootSelector);
      if (!matchesRoot) return;
      trackedNodes.add(node);
      if (typeof node.setAttribute === 'function') {
        node.setAttribute('data-extjs-reinject-key', bundleId);
      }
    } catch (error) {}
  };
  const trackTree = (node) => {
    trackNode(node);
    try {
      if (!node || typeof node.querySelectorAll !== 'function') return;
      const nested = node.querySelectorAll(rootSelector);
      for (const nestedNode of nested) trackNode(nestedNode);
    } catch (error) {}
  };
  const observer = typeof MutationObserver === 'function'
    ? new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const addedNodes = Array.from(mutation.addedNodes || []);
          for (const addedNode of addedNodes) {
            trackTree(addedNode);
          }
        }
      })
    : null;
  try {
    if (observer && document && document.documentElement) {
      observer.observe(document.documentElement, {childList: true, subtree: true});
    }
  } catch (error) {}
  const cleanupTrackedNodes = () => {
    try {
      if (observer) observer.disconnect();
    } catch (error) {}
    try {
      const keyedNodes = Array.from(document.querySelectorAll(keyedSelector));
      for (const keyedNode of keyedNodes) {
        if (keyedNode && typeof keyedNode.remove === 'function') keyedNode.remove();
      }
    } catch (error) {}
    try {
      for (const trackedNode of trackedNodes) {
        if (trackedNode && trackedNode.isConnected && typeof trackedNode.remove === 'function') {
          trackedNode.remove();
        }
      }
    } catch (error) {}
  };
  registry[bundleId] = {
    cleanup: cleanupTrackedNodes,
    generation: previousGeneration,
    __extjsGeneration: previousGeneration
  };
  try {
    if (typeof globalThis === 'object' && globalThis && extensionBase) {
      globalThis.__EXTJS_EXTENSION_BASE__ = extensionBase;
    }
    if (typeof document === 'object' && document && document.documentElement && extensionBase) {
      document.documentElement.setAttribute('data-extjs-extension-base', extensionBase);
    }
    (0, eval)(source);
  } catch (error) {
    return {
      ok: false,
      error: String((error && error.stack) || (error && error.message) || error || 'unknown'),
      trackedRoots: trackedNodes.size,
      existingRootCount: (() => {
        try { return document.querySelectorAll(rootSelector).length; } catch (innerError) { return -1; }
      })()
    };
  }
  setTimeout(() => {
    try {
      const keyedNodes = Array.from(document.querySelectorAll(keyedSelector));
      for (const keyedNode of keyedNodes) trackedNodes.add(keyedNode);
    } catch (error) {}
  }, 0);
  setTimeout(() => {
    try {
      if (observer) observer.disconnect();
    } catch (error) {}
  }, 2000);
  return {
    ok: true,
    trackedRoots: trackedNodes.size,
    existingRootCount: (() => {
      try { return document.querySelectorAll(rootSelector).length; } catch (innerError) { return -1; }
    })(),
    liveRoots: (() => {
      try {
        return Array.from(document.querySelectorAll(rootSelector)).map((node) => ({
          key: node && typeof node.getAttribute === 'function' ? node.getAttribute('data-extjs-reinject-key') || null : null,
          root: node && typeof node.getAttribute === 'function' ? node.getAttribute('data-extension-root') || null : null,
          build: node && typeof node.getAttribute === 'function' ? node.getAttribute('data-extjs-reinject-build') || null : null,
          text: String(node && node.textContent || '').slice(0, 120)
        }));
      } catch (error) {
        return [];
      }
    })(),
    hasChromeRuntime: (() => {
      try { return !!(globalThis && globalThis.chrome && globalThis.chrome.runtime); } catch (error) { return false; }
    })()
  };
})()`
  }

  private patchReinjectSourceForInvalidatedRuntime(source: string): string {
    return source.replace(
      '__webpack_require__.p = __webpack_require__.webExtRt.runtime.getURL("/");',
      [
        'try {',
        '  __webpack_require__.p = __webpack_require__.webExtRt.runtime.getURL("/");',
        '} catch (_extjsRuntimeError) {',
        '  if (__extjsBase) {',
        '    __webpack_require__.p = __extjsBase.replace(/\\/+$/, "/") + String("/").replace(/^\\/+/, "");',
        '  } else {',
        '    __webpack_require__.p = "";',
        '  }',
        '}'
      ].join('\n')
    )
  }

  private async resolveExecutionContextId(
    sessionId: string,
    rule: ContentScriptTargetRule
  ): Promise<number | undefined> {
    if (!this.cdp) return undefined

    const frameId = await this.getTopFrameId(sessionId)
    const contexts = await this.collectExecutionContexts(sessionId)

    if (rule.world === 'main') {
      const defaultContext = contexts.find((context) => {
        const auxData = context?.auxData || {}
        return (
          auxData.type === 'default' &&
          auxData.isDefault === true &&
          (!frameId || !auxData.frameId || String(auxData.frameId) === frameId)
        )
      })
      return typeof defaultContext?.id === 'number'
        ? defaultContext.id
        : undefined
    }

    const extensionId =
      this.extensionId || (await this.deriveExtensionIdFromTargets())
    if (!extensionId) return undefined

    const extensionOrigin = `chrome-extension://${extensionId}`
    const isolatedContext = contexts.find((context) => {
      const auxData = context?.auxData || {}
      return (
        auxData.type === 'isolated' &&
        String(context?.origin || '') === extensionOrigin &&
        (!frameId || !auxData.frameId || String(auxData.frameId) === frameId)
      )
    })

    return typeof isolatedContext?.id === 'number'
      ? isolatedContext.id
      : undefined
  }

  private async getTopFrameId(sessionId: string): Promise<string | undefined> {
    if (!this.cdp) return undefined

    try {
      const frameTree = (await this.cdp.sendCommand(
        'Page.getFrameTree',
        {},
        sessionId
      )) as {
        frameTree?: {frame?: {id?: string}}
      }
      const frameId = frameTree?.frameTree?.frame?.id
      return typeof frameId === 'string' && frameId ? frameId : undefined
    } catch {
      return undefined
    }
  }

  private async collectExecutionContexts(sessionId: string): Promise<any[]> {
    if (!this.cdp) return []

    const contextsById = new Map<number, any>()
    const unsubscribe = this.cdp.onProtocolEvent((message) => {
      if (
        String((message as {sessionId?: string}).sessionId || '') !== sessionId
      ) {
        return
      }
      if (String(message.method || '') !== 'Runtime.executionContextCreated') {
        return
      }
      const context = (message as {params?: {context?: any}}).params?.context
      const contextId = context?.id
      if (typeof contextId === 'number') {
        contextsById.set(contextId, context)
      }
    })

    try {
      await this.cdp.sendCommand('Runtime.enable', {}, sessionId)
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      unsubscribe()
    }

    return Array.from(contextsById.values())
  }
}
