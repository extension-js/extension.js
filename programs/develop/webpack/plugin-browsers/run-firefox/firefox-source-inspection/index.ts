// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {FirefoxContext} from '../firefox-context'
import * as messages from '../../browsers-lib/messages'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import {MessagingClient} from './remote-firefox/messaging-client'
import {attachConsoleListeners} from './remote-firefox/logging'
import {selectActors} from './remote-firefox/setup-firefox-inspection-actors'
import {ensureNavigatedAndLoaded} from './remote-firefox/setup-firefox-inspection-navigation'
import {
  resolveConsoleActorMethod,
  waitForContentScriptInjectionMethod,
  getPageHTML
} from './remote-firefox/source-inspect'
import type {DevOptions} from '../../../webpack-types'
import {
  applySourceRedaction,
  buildHtmlSummary,
  diffDomSnapshots,
  emitActionEvent,
  formatHtmlSentinelBegin,
  formatHtmlSentinelEnd,
  hashStringFNV1a,
  normalizeSourceOutputConfig,
  truncateByBytes,
  type DomSnapshot,
  type SourceStage
} from '../../browsers-lib/source-output'

const MAX_CONNECT_RETRIES = 60
const CONNECT_RETRY_INTERVAL_MS = 500
const PAGE_READY_TIMEOUT_MS = 8000
const CHANGE_DEBOUNCE_MS = 300

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class FirefoxSourceInspectionPlugin {
  private readonly host: any
  private readonly _ctx?: FirefoxContext

  private devOptions?: DevOptions & {
    startingUrl?: string
    instanceId?: string
  }
  private client: MessagingClient | null = null
  private currentConsoleActor: string | null = null
  private currentTabActor: string | null = null
  private isWatching = false
  private debounceTimer: NodeJS.Timeout | null = null
  private initialized = false
  private lastUrlToInspect: string | null = null
  private lastOutputHash?: string
  private lastByteLength?: number
  private lastSummary?: ReturnType<typeof buildHtmlSummary>
  private lastDomSnapshot?: DomSnapshot
  private consoleCounts = {
    error: 0,
    warn: 0,
    info: 0,
    log: 0,
    debug: 0
  }
  private consoleTop = new Map<
    string,
    {level: string; text: string; count: number; sourceUrl?: string}
  >()
  private consoleCaptureReady = false

  constructor(host: any, ctx?: FirefoxContext) {
    this.host = host
    this._ctx = ctx
  }

  private setDevOptions() {
    if (!this.devOptions) {
      this.devOptions = {
        browser: this.host.browser,
        mode: this.host.mode || 'development',
        source: this.host.source as string,
        watchSource: this.host.watchSource,
        startingUrl: this.host.startingUrl,
        port: this.host.port,
        instanceId: this.host.instanceId,
        sourceFormat: this.host.sourceFormat,
        sourceSummary: this.host.sourceSummary,
        sourceMeta: this.host.sourceMeta,
        sourceProbe: this.host.sourceProbe,
        sourceTree: this.host.sourceTree,
        sourceConsole: this.host.sourceConsole,
        sourceDom: this.host.sourceDom,
        sourceMaxBytes: this.host.sourceMaxBytes,
        sourceRedact: this.host.sourceRedact,
        sourceIncludeShadow: this.host.sourceIncludeShadow,
        sourceDiff: this.host.sourceDiff,
        logFormat: this.host.logFormat
      }
    }
  }

  private getOutputConfig() {
    return normalizeSourceOutputConfig({
      format: this.devOptions?.sourceFormat,
      summary: this.devOptions?.sourceSummary,
      maxBytes: this.devOptions?.sourceMaxBytes,
      redact: this.devOptions?.sourceRedact,
      includeShadow: this.devOptions?.sourceIncludeShadow,
      sourceEnabled: Boolean(
        this.devOptions?.source || this.devOptions?.watchSource
      ),
      logFormat: this.devOptions?.logFormat
    })
  }

  private buildPrettyTitle(
    stage: SourceStage,
    url?: string,
    title?: string
  ): string {
    const parts: string[] = []
    if (stage === 'updated') {
      parts.push('UPDATED - after content script injection')
    } else if (stage === 'pre_injection') {
      parts.push('INITIAL - before content script injection')
    }

    if (url || title) {
      const urlPart = url ? `URL: ${url}` : 'URL: unknown'
      const titlePart = title ? `TITLE: ${title}` : 'TITLE: unknown'
      parts.push(`${urlPart} | ${titlePart}`)
    }

    if (parts.length === 0) return 'HTML'

    return parts.join(' | ')
  }

  private getFrameContext(meta: {url?: string}): {
    frameId?: string
    frameUrl?: string
  } {
    return {
      frameId: this.currentTabActor || this.currentConsoleActor || undefined,
      frameUrl: meta.url
    }
  }

  private emitSourceOutput(
    html: string,
    stage: SourceStage,
    meta: {url?: string; title?: string}
  ) {
    const outputConfig = this.getOutputConfig()
    const frameContext = this.getFrameContext(meta)
    const redacted = applySourceRedaction(html, outputConfig.redact)
    const summary = outputConfig.summary
      ? buildHtmlSummary(redacted)
      : undefined
    const {output, truncated, byteLength} = truncateByBytes(
      redacted,
      outputConfig.maxBytes
    )
    const hash = hashStringFNV1a(output)
    const shouldDiff =
      Boolean(this.devOptions?.sourceDiff) && stage === 'updated'
    const diff =
      shouldDiff && this.lastOutputHash
        ? {
            changed: this.lastOutputHash !== hash,
            prevHash: this.lastOutputHash,
            hash,
            byteDelta:
              typeof this.lastByteLength === 'number'
                ? byteLength - this.lastByteLength
                : undefined,
            summaryDelta:
              summary && this.lastSummary
                ? {
                    extensionRoots:
                      summary.counts.extensionRoots -
                      this.lastSummary.counts.extensionRoots,
                    shadowRoots:
                      summary.counts.shadowRoots -
                      this.lastSummary.counts.shadowRoots,
                    scripts:
                      summary.counts.scripts - this.lastSummary.counts.scripts,
                    styles:
                      summary.counts.styles - this.lastSummary.counts.styles,
                    snippetChanged: summary.snippet !== this.lastSummary.snippet
                  }
                : undefined
          }
        : undefined

    if (outputConfig.format === 'pretty') {
      console.log(messages.sourceInspectorHTMLOutputHeader())
      const heading = outputConfig.summary
        ? `SUMMARY - ${this.buildPrettyTitle(stage, meta.url, meta.title)}`
        : this.buildPrettyTitle(stage, meta.url, meta.title)
      console.log(messages.sourceInspectorHTMLOutputTitle(heading))
      console.log(
        formatHtmlSentinelBegin({
          url: meta.url,
          title: meta.title,
          stage,
          truncated
        })
      )
      console.log(
        outputConfig.summary ? JSON.stringify(summary, null, 2) : output
      )

      if (diff && diff.changed) {
        console.log(
          messages.sourceInspectorHTMLOutputTitle(
            `DIFF - byteDelta=${diff.byteDelta ?? 'n/a'}`
          )
        )
      }

      console.log(formatHtmlSentinelEnd())

      if (truncated && outputConfig.maxBytes > 0) {
        console.log(
          messages.sourceInspectorHTMLOutputTitle(
            `TRUNCATED - showing first ${outputConfig.maxBytes} bytes (set --source-max-bytes or EXTENSION_SOURCE_MAX_BYTES to adjust)`
          )
        )
      }

      console.log(messages.sourceInspectorHTMLOutputFooter())

      this.lastOutputHash = hash
      this.lastByteLength = byteLength
      this.lastSummary = summary

      emitActionEvent('source_snapshot_captured', {stage})
      this.emitExtraOutputs(stage, {...meta, frameContext})
      return
    }

    const eventBase = {
      schema_version: '1.0',
      timestamp: new Date().toISOString(),
      stage,
      browser: this.devOptions?.browser,
      mode: this.devOptions?.mode,
      url: meta.url,
      title: meta.title,
      frameId: frameContext.frameId,
      frameUrl: frameContext.frameUrl,
      tabId: undefined as number | string | undefined,
      truncated,
      byteLength,
      maxBytes: outputConfig.maxBytes,
      redaction: outputConfig.redact,
      includeShadow: outputConfig.includeShadow,
      source: 'extension.js'
    }

    if (outputConfig.summary) {
      console.log(
        JSON.stringify({
          type: 'page_html_summary',
          ...eventBase,
          summary,
          diff
        })
      )

      this.lastOutputHash = hash
      this.lastByteLength = byteLength
      this.lastSummary = summary
      emitActionEvent('source_snapshot_captured', {stage})
      this.emitExtraOutputs(stage, {...meta, frameContext})
      return
    }

    console.log(
      JSON.stringify({
        type: 'page_html',
        ...eventBase,
        html: output,
        diff
      })
    )
    this.lastOutputHash = hash
    this.lastByteLength = byteLength
    this.lastSummary = summary
    emitActionEvent('source_snapshot_captured', {stage})
    this.emitExtraOutputs(stage, {...meta, frameContext})
  }

  private setupConsoleCapture() {
    if (!this.client || this.consoleCaptureReady) return
    this.consoleCaptureReady = true
    this.client.on('message', (message) => {
      try {
        const type = String((message as any)?.type || '')
        if (!type) return
        let level = 'info'
        let text = ''
        let sourceUrl: string | undefined

        if (type === 'consoleAPICall' || type === 'logMessage') {
          const a = (message as any)?.message || message
          level = String(a.level || a.category || 'log').toLowerCase()
          const arg = (a.arguments && a.arguments[0]) || a.message || a.text
          text = String(
            (arg && (arg.value || arg.text || arg.message || arg)) || ''
          )
          sourceUrl = a.filename || a.sourceName || undefined
        } else if (type === 'pageError') {
          level = 'error'
          text = String(
            (message as any)?.errorMessage || (message as any)?.cause || ''
          )
          sourceUrl =
            (message as any)?.url || (message as any)?.sourceURL || undefined
        } else {
          return
        }

        this.recordConsoleEvent(level, text, sourceUrl)
      } catch {
        // ignore
      }
    })
  }

  private recordConsoleEvent(level: string, text: string, sourceUrl?: string) {
    const normalized = ['error', 'warn', 'info', 'debug', 'log'].includes(level)
      ? level
      : 'log'
    if (normalized in this.consoleCounts) {
      ;(this.consoleCounts as any)[normalized] += 1
    }
    const hash = hashStringFNV1a(`${normalized}:${text}:${sourceUrl || ''}`)
    const existing = this.consoleTop.get(hash)
    if (existing) {
      existing.count += 1
    } else {
      this.consoleTop.set(hash, {
        level: normalized,
        text,
        count: 1,
        sourceUrl
      })
    }
  }

  private async emitExtraOutputs(
    stage: SourceStage,
    meta: {
      url?: string
      title?: string
      frameContext?: {frameId?: string; frameUrl?: string}
    }
  ) {
    if (!this.client || !this.currentConsoleActor) return
    const outputConfig = this.getOutputConfig()

    if (this.devOptions?.sourceMeta) {
      const metaSnapshot = await this.evaluateJson(
        this.currentConsoleActor,
        `(() => {
          try {
            return {
              readyState: document.readyState,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio
              },
              frameCount: (window.frames && window.frames.length) || 0
            };
          } catch (e) {
            return {};
          }
        })()`
      )
      this.emitEventPayload('page_meta', stage, meta, metaSnapshot || {})
    }

    if (Array.isArray(this.devOptions?.sourceProbe)) {
      const probes = await this.evaluateJson(
        this.currentConsoleActor,
        `(() => {
          const selectors = ${JSON.stringify(this.devOptions?.sourceProbe || [])};
          const limit = 3;
          const snippetLen = 140;
          return selectors.map((selector) => {
            let nodes = [];
            try {
              nodes = Array.from(document.querySelectorAll(selector));
            } catch (e) {
              return {selector, count: 0, samples: []};
            }
            const samples = nodes.slice(0, limit).map((node) => {
              const text = (node && node.textContent) ? String(node.textContent) : '';
              return {
                tag: node && node.tagName ? String(node.tagName).toLowerCase() : 'unknown',
                id: node && node.id ? String(node.id) : undefined,
                classes: node && node.className ? String(node.className) : undefined,
                role: node && node.getAttribute ? node.getAttribute('role') : undefined,
                ariaLabel: node && node.getAttribute ? node.getAttribute('aria-label') : undefined,
                textLength: text.length,
                textSnippet: text.trim().slice(0, snippetLen)
              };
            });
            return {selector, count: nodes.length, samples};
          });
        })()`
      )
      this.emitEventPayload('selector_probe', stage, meta, {
        probes: probes || []
      })
    }

    if (this.devOptions?.sourceTree && this.devOptions.sourceTree !== 'off') {
      const tree = await this.evaluateJson(
        this.currentConsoleActor,
        `(() => {
          const rootEl = document.querySelector('#extension-root,[data-extension-root="true"]');
          if (!rootEl) return null;
          const root = (${this.devOptions.sourceIncludeShadow !== 'off' ? 'rootEl.shadowRoot || rootEl' : 'rootEl'});
          const maxDepth = 4;
          const maxNodes = 200;
          let count = 0;
          let truncated = false;
          const nodeInfo = (node, depth) => {
            if (!node || depth > maxDepth || count >= maxNodes) {
              truncated = truncated || count >= maxNodes;
              return null;
            }
            if (node.nodeType !== 1) return null;
            count++;
            const el = node;
            const text = el.textContent ? String(el.textContent).trim() : '';
            const children = [];
            if (depth < maxDepth) {
              const nodes = el.children ? Array.from(el.children) : [];
              for (const child of nodes) {
                const childInfo = nodeInfo(child, depth + 1);
                if (childInfo) children.push(childInfo);
              }
            }
            return {
              tag: el.tagName ? String(el.tagName).toLowerCase() : 'unknown',
              id: el.id ? String(el.id) : undefined,
              classes: el.className ? String(el.className) : undefined,
              role: el.getAttribute ? el.getAttribute('role') : undefined,
              ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : undefined,
              textLength: text.length,
              childCount: children.length,
              children
            };
          };
          const tree = nodeInfo(root, 0);
          return {
            rootMode: root === rootEl ? 'element' : 'shadow',
            depthLimit: maxDepth,
            nodeLimit: maxNodes,
            truncated,
            tree
          };
        })()`
      )
      if (tree) {
        this.emitEventPayload('extension_root_tree', stage, meta, tree)
      }
    }

    if (this.devOptions?.sourceDom) {
      const snapshot = await this.getDomSnapshot()
      if (snapshot) {
        this.emitEventPayload('dom_snapshot', stage, meta, snapshot)
        if (stage === 'updated') {
          const diff = diffDomSnapshots(this.lastDomSnapshot, snapshot)
          this.emitEventPayload('dom_diff', stage, meta, diff)
        }
        this.lastDomSnapshot = snapshot
      }
    }

    if (this.devOptions?.sourceConsole) {
      const top = Array.from(this.consoleTop.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
      this.emitEventPayload('console_summary', stage, meta, {
        counts: this.consoleCounts,
        top,
        supported: true
      })
    }
  }

  private async evaluateJson(actor: string, expression: string) {
    if (!this.client) return undefined
    try {
      const serializedExpression = JSON.stringify(expression)
      const json = await this.client.evaluate(
        actor,
        `(() => {
          try {
            const __expr = ${serializedExpression};
            return JSON.stringify((0, eval)(__expr));
          } catch (e) {
            return '';
          }
        })()`
      )
      if (typeof json === 'string' && json.length > 0) {
        return JSON.parse(json)
      }
    } catch {
      // ignore
    }
    return undefined
  }

  private async getDomSnapshot(): Promise<DomSnapshot | undefined> {
    if (!this.client || !this.currentConsoleActor) return undefined
    const includeShadow = this.devOptions?.sourceIncludeShadow !== 'off'
    const payload = await this.evaluateJson(
      this.currentConsoleActor,
      `(() => {
        const rootEl = document.querySelector('#extension-root,[data-extension-root="true"]');
        if (!rootEl) return null;
        const root = (${includeShadow ? 'rootEl.shadowRoot || rootEl' : 'rootEl'});
        const maxDepth = 6;
        const maxNodes = 500;
        let count = 0;
        let truncated = false;
        const nodes = [];
        const childIndex = (node) => {
          if (!node || !node.parentElement) return 0;
          const siblings = Array.from(node.parentElement.children || []);
          return siblings.indexOf(node);
        };
        const walk = (node, depth, path) => {
          if (!node || depth > maxDepth || count >= maxNodes) {
            truncated = truncated || count >= maxNodes;
            return;
          }
          if (node.nodeType !== 1) return;
          count++;
          const el = node;
          const text = el.textContent ? String(el.textContent).trim() : '';
          const key = path;
          nodes.push({
            key,
            tag: el.tagName ? String(el.tagName).toLowerCase() : 'unknown',
            id: el.id ? String(el.id) : undefined,
            classes: el.className ? String(el.className) : undefined,
            role: el.getAttribute ? el.getAttribute('role') : undefined,
            ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : undefined,
            name: el.getAttribute ? el.getAttribute('name') : undefined,
            type: el.getAttribute ? el.getAttribute('type') : undefined,
            textLength: text.length,
            childCount: el.children ? el.children.length : 0
          });
          if (depth >= maxDepth) return;
          const children = el.children ? Array.from(el.children) : [];
          for (const child of children) {
            const idx = childIndex(child);
            const childPath =
              path +
              '/' +
              child.tagName.toLowerCase() +
              '[' +
              idx +
              ']';
            walk(child, depth + 1, childPath);
          }
        };
        const rootKey = root === rootEl
          ? rootEl.tagName.toLowerCase() + '[0]'
          : rootEl.tagName.toLowerCase() + '[0]/shadow-root[0]';
        walk(root, 0, rootKey);
        return {
          rootMode: root === rootEl ? 'element' : 'shadow',
          depthLimit: maxDepth,
          nodeLimit: maxNodes,
          truncated,
          nodes
        };
      })()`
    )
    if (payload && typeof payload === 'object') return payload as DomSnapshot
    return undefined
  }

  private emitEventPayload(
    type: string,
    stage: SourceStage,
    meta: {
      url?: string
      title?: string
      frameContext?: {frameId?: string; frameUrl?: string}
    },
    payload: Record<string, unknown>
  ) {
    const outputConfig = this.getOutputConfig()
    const base = {
      type,
      schema_version: '1.0',
      timestamp: new Date().toISOString(),
      stage,
      browser: this.devOptions?.browser,
      mode: this.devOptions?.mode,
      url: meta.url,
      title: meta.title,
      frameId: meta.frameContext?.frameId,
      frameUrl: meta.frameContext?.frameUrl,
      source: 'extension.js'
    }

    if (outputConfig.format === 'pretty') {
      console.log(messages.sourceInspectorHTMLOutputHeader())
      console.log(messages.sourceInspectorHTMLOutputTitle(type))
      console.log(JSON.stringify({...base, ...payload}, null, 2))
      console.log(messages.sourceInspectorHTMLOutputFooter())
      return
    }

    console.log(JSON.stringify({...base, ...payload}))
  }

  private async getRdpPort() {
    const instanceId = this.devOptions?.instanceId
    return deriveDebugPortWithInstance(this.devOptions?.port, instanceId)
  }

  private async initialize() {
    if (this.initialized) return

    const client = new MessagingClient()
    const port = await this.getRdpPort()

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.sourceInspectorWaitingForFirefox())
    }

    let retries = 0

    while (retries < MAX_CONNECT_RETRIES) {
      try {
        await client.connect(port)
        this.client = client
        this.setupConsoleCapture()

        if (this.devOptions?.sourceConsole) {
          await attachConsoleListeners(client)
        }

        this.initialized = true

        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(messages.firefoxRemoteDebuggingReady())
          console.log(messages.sourceInspectorInitialized())
        }
        return
      } catch (err) {
        retries++

        if (retries % 10 === 0) {
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(
              messages.sourceInspectorFirefoxNotReadyYet(
                retries,
                MAX_CONNECT_RETRIES
              )
            )
          }
        }
        await wait(CONNECT_RETRY_INTERVAL_MS)
      }
    }

    throw new Error(messages.sourceInspectorFirefoxDebuggingRequired(port))
  }

  private resolveUrlToInspect() {
    if (
      this.devOptions?.source &&
      typeof this.devOptions.source === 'string' &&
      this.devOptions.source !== 'true'
    ) {
      return this.devOptions.source
    }

    if (this.devOptions?.startingUrl) return this.devOptions.startingUrl

    throw new Error(messages.sourceInspectorUrlRequired())
  }

  private async selectActors(urlToInspect: string) {
    if (!this.client) {
      throw new Error(messages.sourceInspectorClientNotInitialized())
    }

    return selectActors(this.client, urlToInspect)
  }

  private async ensureNavigatedAndLoaded(
    urlToInspect: string,
    tabActor: string
  ) {
    if (!this.client) {
      throw new Error(messages.sourceInspectorClientNotInitialized())
    }

    return ensureNavigatedAndLoaded(this.client, urlToInspect, tabActor)
  }

  private async ensureUrlAndReady(consoleActor: string, urlToInspect: string) {
    if (!this.client) {
      return
    }

    try {
      const href = await this.client.evaluate(
        consoleActor,
        'String(location.href)'
      )

      if (typeof href !== 'string' || !href.startsWith(urlToInspect)) {
        await this.client.navigateViaScript(consoleActor, urlToInspect)
      }
    } catch (error) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        const err = error as Error
        console.warn(
          '[RDP] ensureUrlAndReady evaluate/navigateViaScript failed:',
          String(err.message || err)
        )
      }
    }

    await this.client.waitForPageReady(
      consoleActor,
      urlToInspect,
      PAGE_READY_TIMEOUT_MS
    )
  }

  private async resolveConsoleActor(tabActor: string, urlToInspect: string) {
    if (!this.client)
      throw new Error(messages.sourceInspectorClientNotInitialized())
    return await resolveConsoleActorMethod(this.client, tabActor, urlToInspect)
  }

  private async printHTML(consoleActor: string) {
    if (!this.client) {
      throw new Error('RDP client not initialized')
    }

    // Retry up to 3 times, re-resolving console actor between attempts
    let lastError = null

    for (let attempt = 0; attempt < 3; attempt++) {
      let actorToUse = consoleActor

      try {
        if (this.currentTabActor && this.lastUrlToInspect) {
          const fresh = await this.resolveConsoleActor(
            this.currentTabActor,
            this.lastUrlToInspect
          )
          if (fresh) actorToUse = fresh
        }
      } catch (error) {
        // Ignore
      }

      try {
        const descriptor = this.currentTabActor || actorToUse
        if (this.lastUrlToInspect) {
          await this.ensureUrlAndReady(actorToUse, this.lastUrlToInspect)
        }

        const meta: {url?: string; title?: string} = {}
        try {
          const currentUrl = await this.client.evaluate(
            actorToUse,
            'String(location.href)'
          )
          if (typeof currentUrl === 'string') meta.url = currentUrl
          const currentTitle = await this.client.evaluate(
            actorToUse,
            'String(document.title)'
          )
          if (typeof currentTitle === 'string') meta.title = currentTitle
        } catch {
          // Ignore
        }

        const html =
          (await getPageHTML(this.client, descriptor, actorToUse)) || ''
        this.emitSourceOutput(html, 'post_injection', meta)
        return
      } catch (err) {
        lastError = err
      }
      await wait(200)
    }

    throw lastError || new Error(messages.sourceInspectorHtmlExtractFailed())
  }

  private async waitForContentScriptInjection(consoleActor: string) {
    if (!this.client) return
    await waitForContentScriptInjectionMethod(this.client, consoleActor)
  }

  private async handleFileChange() {
    if (!this.client || !this.currentConsoleActor) return

    if (this.debounceTimer) clearTimeout(this.debounceTimer)

    this.debounceTimer = setTimeout(async () => {
      try {
        emitActionEvent('watch_rebuild_triggered', {})
        if (this.currentTabActor && this.lastUrlToInspect) {
          const freshConsole = await this.resolveConsoleActor(
            this.currentTabActor,
            this.lastUrlToInspect
          )
          if (freshConsole) this.currentConsoleActor = freshConsole
        }

        if (this.lastUrlToInspect) {
          await this.ensureUrlAndReady(
            this.currentConsoleActor!,
            this.lastUrlToInspect
          )
        }

        await this.waitForContentScriptInjection(this.currentConsoleActor!)
        let lastError: unknown = null

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const descriptor = this.currentTabActor || this.currentConsoleActor!
            const html = (await getPageHTML(
              this.client!,
              descriptor,
              this.currentConsoleActor!
            )) as string
            const meta: {url?: string; title?: string} = {}
            try {
              const currentUrl = await this.client!.evaluate(
                this.currentConsoleActor!,
                'String(location.href)'
              )

              if (typeof currentUrl === 'string') meta.url = currentUrl

              const currentTitle = await this.client!.evaluate(
                this.currentConsoleActor!,
                'String(document.title)'
              )

              if (typeof currentTitle === 'string') meta.title = currentTitle
            } catch {
              // ignore
            }
            this.emitSourceOutput(html, 'updated', meta)

            return
          } catch (err) {
            lastError = err
          }
          await wait(200)
        }
        throw lastError || new Error('Failed to update HTML after retries')
      } catch (err) {
        console.error(
          messages.sourceInspectorHTMLUpdateFailed((err as Error).message)
        )
      }
    }, CHANGE_DEBOUNCE_MS)
  }

  apply(compiler: Compiler) {
    if (this.host.dryRun) return
    if (compiler.options.mode !== 'development') return

    this.setDevOptions()

    if (!this.devOptions?.source && !this.devOptions?.watchSource) {
      return
    }

    compiler.hooks.done.tapAsync(
      'setup-firefox-inspection',
      async (_stats, done) => {
        try {
          if (!this.initialized) {
            await this.initialize()
          }

          const urlToInspect = this.resolveUrlToInspect()
          this.lastUrlToInspect = urlToInspect

          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(messages.sourceInspectorWillInspect(urlToInspect))
          }

          const {tabActor, consoleActor} = await this.selectActors(urlToInspect)

          this.currentTabActor = tabActor
          emitActionEvent('navigation_start', {url: urlToInspect})
          await this.ensureNavigatedAndLoaded(urlToInspect, tabActor)
          emitActionEvent('navigation_end', {url: urlToInspect})

          const resolvedConsoleActor = await this.resolveConsoleActor(
            tabActor,
            urlToInspect
          )

          this.currentConsoleActor = resolvedConsoleActor || consoleActor

          if (this.currentConsoleActor) {
            await this.waitForContentScriptInjection(this.currentConsoleActor)
            emitActionEvent('content_script_injected', {url: urlToInspect})

            // Pass descriptor and console hints for robust HTML extraction
            await this.printHTML(this.currentConsoleActor)
          }

          if (this.devOptions?.watchSource) {
            // On each rebuild, re-print current HTML immediately (debounced by handleFileChange)
            this.isWatching = true
            await this.handleFileChange()
          }
        } catch (error) {
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.error(
              messages.sourceInspectorSetupFailed((error as Error).message)
            )
          }
        }
        done()
      }
    )
  }
}
