// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Compiler} from '@rspack/core'
import {WebSocketServer} from 'ws'
import * as messages from '../../browsers-lib/messages'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import {CDPClient} from './cdp-client'
import {waitForChromeRemoteDebugging} from './readiness'
import {ensureTargetAndSession} from './targets'
import {extractPageHtml} from './extract'
import {type DevOptions} from '../../../webpack-types'
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

/**
 * ChromiumSourceInspectionPlugin
 *
 * Intended responsibilities:
 * - Dev-only page/extension inspection; attach to target and extract HTML
 * - Optional watch mode to re-print HTML on file changes
 */
export class ChromiumSourceInspectionPlugin {
  private devOptions: Pick<DevOptions, 'port' | 'source' | 'watchSource'> & {
    startingUrl?: string
    instanceId?: string
    browser?: DevOptions['browser']
    sourceFormat?: 'pretty' | 'json' | 'ndjson'
    sourceSummary?: boolean
    sourceMeta?: boolean
    sourceProbe?: string[]
    sourceTree?: 'off' | 'root-only'
    sourceConsole?: boolean
    sourceDom?: boolean
    sourceMaxBytes?: number
    sourceRedact?: 'off' | 'safe' | 'strict'
    sourceIncludeShadow?: 'off' | 'open-only' | 'all'
    sourceDiff?: boolean
    logFormat?: 'pretty' | 'json' | 'ndjson'
  }
  private cdpClient: CDPClient | null = null
  private currentTargetId: string | null = null
  private currentSessionId: string | null = null
  private isInitialized = false
  private isWatching = false
  private hasInspectedSourceOnce = false
  private debounceTimer: NodeJS.Timeout | null = null
  private runtimeMode?: string
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

  constructor(
    devOptions: Pick<DevOptions, 'port' | 'source' | 'watchSource'> & {
      startingUrl?: string
      instanceId?: string
    },
    _ctx?: unknown
  ) {
    this.devOptions = devOptions
  }

  private isAuthorMode(): boolean {
    const authorMode =
      String(process.env.EXTENSION_AUTHOR_MODE || '')
        .trim()
        .toLowerCase() === 'true'
    const isDevEnv =
      String(process.env.EXTENSION_AUTHOR_MODE || '')
        .trim()
        .toLowerCase() === 'development'
    return authorMode || isDevEnv
  }

  private getOutputConfig() {
    return normalizeSourceOutputConfig({
      format: this.devOptions.sourceFormat,
      summary: this.devOptions.sourceSummary,
      maxBytes: this.devOptions.sourceMaxBytes,
      redact: this.devOptions.sourceRedact,
      includeShadow: this.devOptions.sourceIncludeShadow,
      sourceEnabled: Boolean(
        this.devOptions.source || this.devOptions.watchSource
      ),
      logFormat: this.devOptions.logFormat
    })
  }

  private async getPageMetadata(): Promise<{
    url?: string
    title?: string
  }> {
    if (!this.cdpClient || !this.currentSessionId) return {}
    const meta: {url?: string; title?: string} = {}

    try {
      const url = await this.cdpClient.evaluate(
        this.currentSessionId,
        'String(location.href)'
      )
      if (typeof url === 'string') meta.url = url
    } catch {
      // ignore
    }

    try {
      const title = await this.cdpClient.evaluate(
        this.currentSessionId,
        'String(document.title)'
      )
      if (typeof title === 'string') meta.title = title
    } catch {
      // ignore
    }
    return meta
  }

  private async getFrameContext(): Promise<{
    frameId?: string
    frameUrl?: string
    executionContextId?: number
  }> {
    if (!this.cdpClient || !this.currentSessionId) return {}

    const context: {
      frameId?: string
      frameUrl?: string
      executionContextId?: number
    } = {}

    try {
      const tree = (await this.cdpClient.sendCommand(
        'Page.getFrameTree',
        {},
        this.currentSessionId
      )) as any
      const frame = tree?.frameTree?.frame || tree?.frame
      if (frame?.id) context.frameId = String(frame.id)
      if (frame?.url) context.frameUrl = String(frame.url)
    } catch {
      // ignore
    }
    try {
      const evalResp = (await this.cdpClient.sendCommand(
        'Runtime.evaluate',
        {expression: '1', returnByValue: true},
        this.currentSessionId
      )) as any
      if (typeof evalResp?.executionContextId === 'number') {
        context.executionContextId = evalResp.executionContextId
      }
    } catch {
      // ignore
    }
    return context
  }

  private async getDomSnapshot(): Promise<DomSnapshot | undefined> {
    if (!this.cdpClient || !this.currentSessionId) return undefined
    const includeShadow = this.devOptions.sourceIncludeShadow !== 'off'
    try {
      const payload = await this.cdpClient.evaluate(
        this.currentSessionId,
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
    } catch {
      // ignore
    }
    return undefined
  }

  private async getPageMetaSnapshot(): Promise<{
    readyState?: string
    viewport?: {width: number; height: number; devicePixelRatio: number}
    frameCount?: number
  }> {
    if (!this.cdpClient || !this.currentSessionId) return {}

    try {
      const snapshot = await this.cdpClient.evaluate(
        this.currentSessionId,
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
      if (snapshot && typeof snapshot === 'object') {
        return snapshot as any
      }
    } catch {
      // ignore
    }
    return {}
  }

  private async getSelectorProbes(selectors: string[]): Promise<
    Array<{
      selector: string
      count: number
      samples: Array<{
        tag: string
        id?: string
        classes?: string
        role?: string
        ariaLabel?: string
        textLength?: number
        textSnippet?: string
      }>
    }>
  > {
    if (!this.cdpClient || !this.currentSessionId) return []
    if (!selectors.length) return []
    try {
      const payload = await this.cdpClient.evaluate(
        this.currentSessionId,
        `(() => {
          const selectors = ${JSON.stringify(selectors)};
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
      if (Array.isArray(payload)) return payload as any
    } catch {
      // ignore
    }
    return []
  }

  private async getExtensionRootTree(): Promise<
    | {
        rootMode: 'shadow' | 'element'
        depthLimit: number
        nodeLimit: number
        truncated: boolean
        tree: any
      }
    | undefined
  > {
    if (!this.cdpClient || !this.currentSessionId) return undefined
    const includeShadow = this.devOptions.sourceIncludeShadow !== 'off'

    try {
      const payload = await this.cdpClient.evaluate(
        this.currentSessionId,
        `(() => {
          const rootEl = document.querySelector('#extension-root,[data-extension-root="true"]');
          if (!rootEl) return null;
          const root = (${includeShadow ? 'rootEl.shadowRoot || rootEl' : 'rootEl'});
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
      if (payload && typeof payload === 'object') return payload as any
    } catch {
      // ignore
    }
    return undefined
  }

  private setupConsoleCapture() {
    if (!this.cdpClient) return

    const cdp = this.cdpClient as unknown as {
      onProtocolEvent?: (cb: (message: Record<string, unknown>) => void) => void
    }

    if (typeof cdp.onProtocolEvent !== 'function') return

    cdp.onProtocolEvent((message: Record<string, unknown>) => {
      const method = String(message.method || '')
      const params = (message as any).params || {}

      if (method === 'Log.entryAdded') {
        const entry = params.entry || {}
        const level = String(entry.level || 'log')
        const text = String(entry.text || '')
        const sourceUrl = entry.url ? String(entry.url) : undefined
        this.recordConsoleEvent(level, text, sourceUrl)
      }

      if (method === 'Runtime.consoleAPICalled') {
        const type = String(params.type || 'log')
        const args = Array.isArray(params.args) ? params.args : []
        const stack = params.stackTrace || {}
        const frame = Array.isArray(stack.callFrames)
          ? stack.callFrames[0]
          : null
        const sourceUrl = frame && frame.url ? String(frame.url) : undefined
        const text = args
          .map((arg: any) => {
            if (typeof arg?.value !== 'undefined') return String(arg.value)
            if (typeof arg?.description !== 'undefined')
              return String(arg.description)
            return ''
          })
          .filter(Boolean)
          .join(' ')
        this.recordConsoleEvent(type, text, sourceUrl)
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

  private async emitSourceOutput(html: string, stage: SourceStage) {
    const outputConfig = this.getOutputConfig()
    const {url, title} = await this.getPageMetadata()
    const frameContext = await this.getFrameContext()
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
      Boolean(this.devOptions.sourceDiff) && stage === 'updated'
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
        ? `SUMMARY - ${this.buildPrettyTitle(stage, url, title)}`
        : this.buildPrettyTitle(stage, url, title)
      console.log(messages.sourceInspectorHTMLOutputTitle(heading))
      console.log(
        formatHtmlSentinelBegin({
          url,
          title,
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
      await this.emitExtraOutputs(stage, {url, title, frameContext})
      return
    }

    const eventBase = {
      schema_version: '1.0',
      timestamp: new Date().toISOString(),
      stage,
      browser: this.devOptions.browser,
      mode: this.runtimeMode,
      url,
      title,
      frameId: frameContext.frameId,
      frameUrl: frameContext.frameUrl,
      executionContextId: frameContext.executionContextId,
      tabId: undefined as number | string | undefined,
      truncated,
      byteLength,
      maxBytes: outputConfig.maxBytes,
      redaction: outputConfig.redact,
      includeShadow: outputConfig.includeShadow,
      source: 'extension.js'
    }

    if (outputConfig.summary) {
      const payload = {
        type: 'page_html_summary',
        ...eventBase,
        summary,
        diff
      }
      console.log(JSON.stringify(payload))
      this.lastOutputHash = hash
      this.lastByteLength = byteLength
      this.lastSummary = summary
      emitActionEvent('source_snapshot_captured', {stage})
      await this.emitExtraOutputs(stage, {url, title, frameContext})
      return
    }

    const payload = {
      type: 'page_html',
      ...eventBase,
      html: output,
      diff
    }
    console.log(JSON.stringify(payload))
    this.lastOutputHash = hash
    this.lastByteLength = byteLength
    this.lastSummary = summary
    emitActionEvent('source_snapshot_captured', {stage})
    await this.emitExtraOutputs(stage, {url, title, frameContext})
  }

  private async emitExtraOutputs(
    stage: SourceStage,
    meta: {
      url?: string
      title?: string
      frameContext?: {
        frameId?: string
        frameUrl?: string
        executionContextId?: number
      }
    }
  ) {
    if (this.devOptions.sourceMeta) {
      const metaSnapshot = await this.getPageMetaSnapshot()
      this.emitEventPayload('page_meta', stage, meta, metaSnapshot)
    }

    if (Array.isArray(this.devOptions.sourceProbe)) {
      const probes = await this.getSelectorProbes(this.devOptions.sourceProbe)
      this.emitEventPayload('selector_probe', stage, meta, {probes})
    }

    if (this.devOptions.sourceTree && this.devOptions.sourceTree !== 'off') {
      const tree = await this.getExtensionRootTree()

      if (tree) {
        this.emitEventPayload('extension_root_tree', stage, meta, tree)
      }
    }

    if (this.devOptions.sourceDom) {
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

    if (this.devOptions.sourceConsole) {
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

  private emitEventPayload(
    type: string,
    stage: SourceStage,
    meta: {
      url?: string
      title?: string
      frameContext?: {
        frameId?: string
        frameUrl?: string
        executionContextId?: number
      }
    },
    payload: Record<string, unknown>
  ) {
    const outputConfig = this.getOutputConfig()
    const base = {
      type,
      schema_version: '1.0',
      timestamp: new Date().toISOString(),
      stage,
      browser: this.devOptions.browser,
      mode: this.runtimeMode,
      url: meta.url,
      title: meta.title,
      frameId: meta.frameContext?.frameId,
      frameUrl: meta.frameContext?.frameUrl,
      executionContextId: meta.frameContext?.executionContextId,
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

  private async getCdpPort(): Promise<number> {
    const instanceId = this.devOptions.instanceId
    return deriveDebugPortWithInstance(this.devOptions.port, instanceId)
  }

  async initialize(port?: number): Promise<void> {
    try {
      if (!port) port = await this.getCdpPort()

      const instanceId = this.devOptions.instanceId
      await waitForChromeRemoteDebugging(port, instanceId)

      this.cdpClient = new CDPClient(port)
      await this.cdpClient.connect()
      this.setupConsoleCapture()

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorInitialized())
      }

      this.isInitialized = true
    } catch (error) {
      if (this.isAuthorMode()) {
        console.error(
          messages.sourceInspectorInitializationFailed((error as Error).message)
        )
      }
      throw error
    }
  }

  // The main step for the user: open a URL and get its HTML content
  async inspectSource(
    url: string,
    options?: {
      forceNavigate?: boolean
    }
  ): Promise<string> {
    if (!this.cdpClient) {
      throw new Error(messages.sourceInspectorNotInitialized())
    }

    try {
      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorOpeningUrl(url))
        console.log(messages.sourceInspectorFindingExistingTarget())
      }

      emitActionEvent('navigation_start', {url})
      const {targetId, sessionId} = await ensureTargetAndSession(
        this.cdpClient,
        url,
        options
      )
      this.currentTargetId = targetId
      this.currentSessionId = sessionId

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorWaitingForPageLoad())
      }

      await this.cdpClient.waitForLoadEvent(this.currentSessionId)
      emitActionEvent('navigation_end', {url})

      // Fast initial extract for reliability under short auto-exit windows
      // Print immediately for --source users to see something quickly
      try {
        const outputConfig = this.getOutputConfig()
        const initialHtml = await extractPageHtml(
          this.cdpClient,
          this.currentSessionId,
          this.isAuthorMode(),
          outputConfig.includeShadow
        )
        await this.emitSourceOutput(String(initialHtml || ''), 'pre_injection')
      } catch {
        // best-effort initial print
      }

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorWaitingForContentScripts())
      }

      await this.cdpClient.waitForContentScriptInjection(this.currentSessionId)
      emitActionEvent('content_script_injected', {url})

      // Extra reliable poll: wait until #extension-root with shadowRoot exists (up to ~12s)
      try {
        const deadline = Date.now() + 20000
        const started = Date.now()

        while (Date.now() < deadline) {
          const hasRoot = await this.cdpClient.evaluate(
            this.currentSessionId,
            `(() => { try {
              const hosts = Array.from(document.querySelectorAll('#extension-root,[data-extension-root="true"]'));
              if (!hosts.length) return false;
              for (const h of hosts) {
                try {
                  const sr = h && h.shadowRoot;
                  if (sr && (String(sr.innerHTML||'').length > 0)) return true;
                } catch { /* ignore */ }
              }
              return false;
            } catch { return false } })()`
          )
          if (hasRoot) break
          const elapsed = Date.now() - started
          const delay = elapsed < 2000 ? 150 : 500
          await new Promise((r) => setTimeout(r, delay))
        }
      } catch {
        // ignore
      }

      // This is the real inspection data step for the user (post-injection):
      const outputConfig = this.getOutputConfig()
      const html = await extractPageHtml(
        this.cdpClient,
        this.currentSessionId,
        this.isAuthorMode(),
        outputConfig.includeShadow
      )

      return html
    } catch (error) {
      if (this.isAuthorMode()) {
        console.error(
          messages.sourceInspectorInspectionFailed((error as Error).message)
        )
      }

      throw error
    }
  }

  // Only relevant for development: watch mode and file change handling
  async startWatching(websocketServer: WebSocketServer): Promise<void> {
    if (!this.devOptions.watchSource) return

    if (this.isWatching) {
      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorWatchModeActive())
      }
      return
    }

    this.isWatching = true
    if (this.isAuthorMode()) {
      console.log(messages.sourceInspectorStartingWatchMode())
    }

    this.setupWebSocketHandler(websocketServer)
    if (this.isAuthorMode()) {
      console.log(messages.sourceInspectorCDPConnectionMaintained())
    }
  }

  private setupWebSocketHandler(websocketServer: WebSocketServer) {
    if (!websocketServer || !websocketServer.clients) {
      console.warn(messages.sourceInspectorInvalidWebSocketServer())
      return
    }

    websocketServer.clients.forEach((ws: unknown) => {
      this.setupConnectionHandler(
        ws as {on: (event: 'message', cb: (data: string) => void) => void}
      )
    })

    websocketServer.on('connection', (ws: unknown) => {
      this.setupConnectionHandler(
        ws as {on: (event: 'message', cb: (data: string) => void) => void}
      )
    })
  }

  private setupConnectionHandler(ws: {
    on: (event: 'message', cb: (data: string) => void) => void
  }) {
    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data)
        if (message.type === 'changedFile' && this.isWatching) {
          await this.handleFileChange()
        }
      } catch (error) {
        // Ignore parsing errors
      }
    })
  }

  stopWatching() {
    this.isWatching = false
    if (this.isAuthorMode()) {
      console.log(messages.sourceInspectorWatchModeStopped())
    }
  }

  private async handleFileChange(): Promise<void> {
    if (!this.cdpClient || !this.currentSessionId) {
      console.warn(messages.sourceInspectorNoActiveSession())
      return
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        emitActionEvent('watch_rebuild_triggered', {})
        if (this.isAuthorMode()) {
          console.log(messages.sourceInspectorFileChanged())
          console.log(
            messages.sourceInspectorWaitingForContentScriptReinjection()
          )
        }

        const sourceUrl =
          typeof this.devOptions.source === 'string' &&
          this.devOptions.source !== 'true'
            ? this.devOptions.source
            : ''

        // Deterministic watch behavior: always re-inspect the requested source URL.
        // This avoids stale/foreign tabs becoming the active extraction target.
        if (sourceUrl) {
          emitActionEvent('watch_reinspect_source_url', {url: sourceUrl})
          const html = await this.inspectSource(sourceUrl, {
            forceNavigate: true
          })
          await this.emitSourceOutput(html || '', 'updated')
          return
        }

        await this.cdpClient!.waitForContentScriptInjection(
          this.currentSessionId!
        )

        if (this.isAuthorMode()) {
          console.log(messages.sourceInspectorReExtractingHTML())
        }
        let html = ''
        const outputConfig = this.getOutputConfig()

        try {
          html = await this.cdpClient!.getPageHTML(
            this.currentSessionId!,
            outputConfig.includeShadow
          )
        } catch (e) {
          // Fallback: small delay then try one more time
          // to ensure a print even if timing is tight
          await new Promise((r) => setTimeout(r, 250))
          try {
            html = await this.cdpClient!.getPageHTML(
              this.currentSessionId!,
              outputConfig.includeShadow
            )
          } catch {
            // ignore
          }
        }

        // If still empty, force one more probe read a moment later (JS can be late)
        if (!html) {
          await new Promise((r) => setTimeout(r, 300))
          try {
            html = await this.cdpClient!.getPageHTML(
              this.currentSessionId!,
              outputConfig.includeShadow
            )
          } catch {
            // ignore
          }
        }

        await this.emitSourceOutput(html || '', 'updated')
      } catch (error) {
        console.error(
          messages.sourceInspectorHTMLUpdateFailed((error as Error).message)
        )

        if (
          (error as Error).message.includes('session') ||
          (error as Error).message.includes('target')
        ) {
          console.log(messages.sourceInspectorAttemptingReconnection())
          await this.reconnectToTarget()
        }
      }
    }, 300)
  }

  private async reconnectToTarget(): Promise<void> {
    if (!this.isAuthorMode()) return

    try {
      if (!this.cdpClient || !this.currentTargetId) {
        console.warn(messages.sourceInspectorCannotReconnect())
        return
      }

      console.log(messages.sourceInspectorReconnectingToTarget())
      this.currentSessionId =
        (await this.cdpClient.attachToTarget(this.currentTargetId)) || null
      console.log(
        messages.sourceInspectorReconnectedToTarget(this.currentSessionId || '')
      )
    } catch (error) {
      console.error(
        messages.sourceInspectorReconnectionFailed((error as Error).message)
      )
    }
  }

  // For the user: print the HTML inspection result
  async printHTML(html: string) {
    await this.emitSourceOutput(html, 'post_injection')
  }

  // Only for development: print updated HTML after file change
  async printUpdatedHTML(html: string) {
    await this.emitSourceOutput(html, 'updated')
  }

  async cleanup(): Promise<void> {
    try {
      if (this.isAuthorMode()) {
        this.stopWatching()
      }

      if (this.cdpClient && this.currentTargetId) {
        await this.cdpClient.closeTarget(this.currentTargetId)
      }

      if (this.cdpClient) {
        this.cdpClient.disconnect()
      }

      if (this.isAuthorMode()) {
        console.log(messages.sourceInspectorCleanupComplete())
      }
    } catch (error) {
      if (this.isAuthorMode()) {
        console.error(
          messages.sourceInspectorCleanupError((error as Error).message)
        )
      }
    }
  }

  // The only thing relevant for the user: how to get the inspection data
  apply(compiler: Compiler) {
    if (!this.devOptions.source && !this.devOptions.watchSource) {
      return
    }
    this.runtimeMode = compiler.options.mode || this.runtimeMode

    compiler.hooks.done.tapPromise('setup-chrome-inspection', async (stats) => {
      try {
        if (!this.isInitialized) {
          await this.initialize()
        }

        // User: to see the real inspection data,
        // provide --source <url> or --starting-url <url>
        let urlToInspect: string

        if (
          this.devOptions.source &&
          typeof this.devOptions.source === 'string' &&
          this.devOptions.source !== 'true'
        ) {
          urlToInspect = this.devOptions.source
        } else if (this.devOptions.startingUrl) {
          urlToInspect = this.devOptions.startingUrl
        } else {
          throw new Error(messages.sourceInspectorUrlRequired())
        }

        // This is the main output for the user:
        const html = await this.inspectSource(urlToInspect, {
          forceNavigate:
            this.devOptions.watchSource && this.hasInspectedSourceOnce
        })
        this.hasInspectedSourceOnce = true
        await this.printHTML(html)

        // Watch mode is only for development
        const webSocketServer = (compiler.options as any).webSocketServer

        if (this.devOptions.watchSource) {
          if (webSocketServer) {
            await this.startWatching(webSocketServer)
          } else {
            // Fallback: trigger re-extraction on each rebuild
            try {
              const updated = await this.inspectSource(urlToInspect, {
                forceNavigate: true
              })
              await this.printUpdatedHTML(updated || '')
            } catch {
              // ignore best-effort fallback
            }
          }
        }
      } catch (error) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.error(
            messages.sourceInspectorSetupFailed((error as Error).message)
          )
        }
      }
    })
  }
}
