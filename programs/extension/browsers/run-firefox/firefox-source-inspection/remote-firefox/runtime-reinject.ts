// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {
  type ContentScriptTargetRule,
  resolveEmittedContentScriptFile
} from '../../../browsers-lib/content-script-targets'
import type {MessagingClient} from './messaging-client'

export type AddonRuntimeTarget = {
  consoleActor: string
  targetActor: string
  addonId: string
}

type ListAddonsResponse = {
  addons?: Array<{
    id?: string
    actor?: string
    isWebExtension?: boolean
    manifestURL?: string
  }>
}

// Locate the addon's background descriptor and resolve it into a console actor
// we can evaluate against. Returns undefined if the addon isn't installed yet
// or the descriptor doesn't expose a console actor (e.g. cold event page that
// couldn't be woken)
export async function attachToAddonBackgroundConsole(
  client: MessagingClient,
  addonsActor: string,
  addonId: string
): Promise<AddonRuntimeTarget | undefined> {
  if (!addonsActor || !addonId) return undefined

  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
  let descriptorActor: string | undefined
  let listAddonsResponseSample: unknown = null

  try {
    // listAddons lives on the root actor, not on AddonsManagerActor —
    // addonsActor only handles installTemporaryAddon. The root actor
    // returns webExtensionDescriptors keyed by addon id.
    const response = (await client.request({
      to: 'root',
      type: 'listAddons'
    })) as ListAddonsResponse

    listAddonsResponseSample = (response?.addons || []).map((entry) => ({
      id: String(entry?.id || ''),
      actor: String(entry?.actor || ''),
      isWebExtension: entry?.isWebExtension
    }))

    const match = (response?.addons || []).find(
      (entry) => String(entry?.id || '') === addonId
    )

    descriptorActor =
      typeof match?.actor === 'string' && match.actor ? match.actor : undefined
  } catch (error) {
    if (isAuthor) {
      // eslint-disable-next-line no-console
      console.log(
        `[firefox-rt-reinject] listAddons failed: ${String(
          (error as Error)?.message || error
        )}`
      )
    }
    return undefined
  }

  if (!descriptorActor) {
    if (isAuthor) {
      // eslint-disable-next-line no-console
      console.log(
        `[firefox-rt-reinject] no descriptor matched addonId=${addonId}; addons=${JSON.stringify(
          listAddonsResponseSample
        )}`
      )
    }
    return undefined
  }

  // Modern Firefox (post-Fission) doesn't expose getTarget on
  // webExtensionDescriptor — only [reload, terminateBackgroundScript,
  // reloadDescriptor, getWatcher]. Resolve the watcher and discover the
  // addon's frame target through its target-available-form stream.
  let watcherActor: string
  try {
    const watcherResponse = (await client.request({
      to: descriptorActor,
      type: 'getWatcher'
    })) as {actor?: string}
    if (typeof watcherResponse?.actor !== 'string' || !watcherResponse.actor) {
      if (isAuthor) {
        // eslint-disable-next-line no-console
        console.log(
          `[firefox-rt-reinject] getWatcher(${descriptorActor}) returned no actor`
        )
      }
      return undefined
    }
    watcherActor = watcherResponse.actor
  } catch (error) {
    if (isAuthor) {
      // eslint-disable-next-line no-console
      console.log(
        `[firefox-rt-reinject] getWatcher(${descriptorActor}) failed: ${String(
          (error as Error)?.message || error
        )}`
      )
    }
    return undefined
  }

  const captured: Array<{
    actor?: string
    consoleActor?: string
    url?: string
    targetType?: string
  }> = []
  const messageListener = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const msg = raw as {
      type?: string
      from?: string
      target?: {
        actor?: string
        consoleActor?: string
        url?: string
        targetType?: string
      }
    }
    if (msg.from !== watcherActor) return
    if (msg.type !== 'target-available-form') return
    if (msg.target) captured.push(msg.target)
  }
  client.on('message', messageListener)

  try {
    await client.request({
      to: watcherActor,
      type: 'watchTargets',
      targetType: 'frame'
    })
    // The watchTargets response resolves once initial target-available-form
    // events have been emitted, but Firefox sometimes flushes them on the
    // following tick. Brief settle catches stragglers.
    await new Promise((resolve) => setTimeout(resolve, 200))
  } catch (error) {
    if (isAuthor) {
      // eslint-disable-next-line no-console
      console.log(
        `[firefox-rt-reinject] watchTargets(${watcherActor}) failed: ${String(
          (error as Error)?.message || error
        )}`
      )
    }
    client.removeListener('message', messageListener)
    return undefined
  } finally {
    // Leave the listener attached briefly for late events, then detach to
    // avoid leaking listeners across rebuilds.
    setTimeout(() => {
      client.removeListener('message', messageListener)
    }, 1000)
  }

  if (isAuthor) {
    // eslint-disable-next-line no-console
    console.log(
      `[firefox-rt-reinject] watcher=${watcherActor} captured=${JSON.stringify(
        captured.map((entry) => ({
          url: entry.url,
          targetType: entry.targetType,
          actor: entry.actor ? '<actor>' : null,
          consoleActor: entry.consoleActor ? '<consoleActor>' : null
        }))
      )}`
    )
  }

  // The watcher is per-descriptor, so any frame-target it emits belongs to
  // this addon. Prefer the moz-extension:// frame (the addon background) over
  // any incidental about:blank entries.
  const addonFrame =
    captured.find(
      (entry) =>
        typeof entry.url === 'string' &&
        entry.url.startsWith('moz-extension://') &&
        !!entry.actor &&
        !!entry.consoleActor
    ) ||
    captured.find((entry) => !!entry.actor && !!entry.consoleActor)

  if (!addonFrame || !addonFrame.actor || !addonFrame.consoleActor) {
    return undefined
  }

  return {
    consoleActor: String(addonFrame.consoleActor),
    targetActor: String(addonFrame.actor),
    addonId
  }
}

type ReinjectionPayloadEntry = {
  index: number
  world: 'extension' | 'main'
  matches: string[]
  urls: string[]
  jsFile: string
  cssFile: string | null
  buildToken: string | null
  proofMarker: string | null
}

export type ReinjectionReport = {
  phase: 'evaluated' | 'unavailable' | 'skipped'
  reason?: string
  addonId?: string
  reinjectedTabs?: number
  matches?: Array<{index: number; queriedTabs: number; matchingTabs: number}>
  hasRuntime?: boolean
  hasScripting?: boolean
  entries?: number
}

function buildPayload(
  outPath: string,
  rules: ContentScriptTargetRule[],
  matchingUrlsByRule: Map<number, Set<string>>
): ReinjectionPayloadEntry[] {
  return rules
    .map((rule): ReinjectionPayloadEntry | null => {
      // Firefox does not support world:"MAIN" via browser.scripting until
      // FF 128, and the codebase already filters MAIN-world rules out of
      // Firefox at the rule-collection layer. Treat any straggler as a skip
      // rather than risking an executeScript reject
      if (rule.world === 'main') return null

      const jsPath = resolveEmittedContentScriptFile(outPath, rule.index, 'js')
      const cssPath = resolveEmittedContentScriptFile(
        outPath,
        rule.index,
        'css'
      )
      if (!jsPath || !fs.existsSync(jsPath)) return null

      const jsFile = path.relative(outPath, jsPath).replace(/\\/g, '/')
      const cssFile =
        cssPath && fs.existsSync(cssPath)
          ? path.relative(outPath, cssPath).replace(/\\/g, '/')
          : null
      const jsSource = fs.readFileSync(jsPath, 'utf-8')
      const buildTokenMatch = jsSource.match(
        /__EXTENSIONJS_REINJECT_BUILD_TOKEN\s*=\s*"([^"]+)"/
      )
      const proofMatch =
        jsSource.match(
          /extjs-firefox-live-content-css-modules:script-primary-\d+/
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
      (entry): entry is ReinjectionPayloadEntry =>
        !!entry && entry.urls.length > 0
    )
}

// Mirror of CDPExtensionController.reinjectMatchingTabsViaExtensionRuntime for
// Firefox: build a per-rule payload, then evaluateJSAsync against the addon
// background's consoleActor with code that calls browser.scripting from the
// addon's own context
export async function reinjectMatchingTabsViaAddonRuntime(
  client: MessagingClient,
  opts: {
    outPath: string
    rules: ContentScriptTargetRule[]
    addonsActor: string
    addonId: string
    matchUrl: (url: string, rule: ContentScriptTargetRule) => boolean
    // Firefox's watcher emits target-available-form only when a target
    // becomes available — not on every watchTargets call. Once the first
    // attach consumes those events, a second attach gets nothing. Caller
    // can pass the previously-resolved target to skip re-discovery.
    cachedTarget?: AddonRuntimeTarget
    // Notify the caller when discovery succeeds so they can update their
    // cache. Called only on a fresh resolve; not when cachedTarget is used.
    onTargetResolved?: (target: AddonRuntimeTarget) => void
  }
): Promise<{reinjectedTabs: number; report: ReinjectionReport}> {
  const {
    outPath,
    rules,
    addonsActor,
    addonId,
    matchUrl,
    cachedTarget,
    onTargetResolved
  } = opts

  if (rules.length === 0) {
    return {
      reinjectedTabs: 0,
      report: {phase: 'skipped', reason: 'no_rules', addonId}
    }
  }

  const matchingUrlsByRule = new Map<number, Set<string>>()

  try {
    const targets = (await client.getTargets()) as Array<{url?: string}>

    for (const target of targets || []) {
      const url = String(target?.url || '')
      if (!url) continue

      for (const rule of rules) {
        if (!matchUrl(url, rule)) continue

        const urls = matchingUrlsByRule.get(rule.index) || new Set<string>()
        urls.add(url)
        matchingUrlsByRule.set(rule.index, urls)
      }
    }
  } catch {
    // listTabs may fail if the RDP session was just torn down — fall through
    // to an empty payload, which will be reported as a skip below.
  }

  const payload = buildPayload(outPath, rules, matchingUrlsByRule)

  if (payload.length === 0) {
    return {
      reinjectedTabs: 0,
      report: {phase: 'skipped', reason: 'no_payload', addonId}
    }
  }

  let target: AddonRuntimeTarget | undefined =
    cachedTarget && cachedTarget.addonId === addonId ? cachedTarget : undefined
  if (!target) {
    target = await attachToAddonBackgroundConsole(
      client,
      addonsActor,
      addonId
    )
    if (target && onTargetResolved) {
      try {
        onTargetResolved(target)
      } catch {}
    }
  }
  if (!target) {
    return {
      reinjectedTabs: 0,
      report: {
        phase: 'unavailable',
        reason: 'no_runtime_target',
        addonId
      }
    }
  }

  // Firefox RDP's evaluateJSAsync returns an object-grip for object results
  // and treats top-level await as syntax error / returns undefined. The
  // reliable cross-version pattern is: kick off the async work, store the
  // result as a JSON string on globalThis, and poll it from the client.
  // Each poll is a fresh synchronous eval that returns a primitive string.
  const resultKey = `__EXTJS_REINJECT_RESULT_${Date.now()}__`
  const errorKey = `${resultKey}_ERR`
  const startedKey = `${resultKey}_STARTED`
  const kickoffExpression = `(() => {
    globalThis['${resultKey}'] = '';
    globalThis['${errorKey}'] = '';
    globalThis['${startedKey}'] = true;
    (async () => {
      try {
        const payload = ${JSON.stringify(payload)};
        const runtimeApi =
          typeof globalThis === 'object' && globalThis
            ? (globalThis.browser || globalThis.chrome || null)
            : null;
        const runtime =
          runtimeApi && runtimeApi.scripting && runtimeApi.tabs ? runtimeApi : null;
        if (!runtime) {
          globalThis['${resultKey}'] = JSON.stringify({
            reinjectedTabs: 0,
            hasRuntime: false,
            hasChrome: !!runtimeApi,
            hasScripting: !!(runtimeApi && runtimeApi.scripting),
            hasTabs: !!(runtimeApi && runtimeApi.tabs),
            entries: payload.length,
            matches: []
          });
          return;
        }
        let reinjectedTabs = 0;
        const matches = [];
        for (const entry of payload) {
          let queriedTabs = [];
          try {
            queriedTabs = await runtime.tabs.query(
              entry.matches.length > 0 ? { url: entry.matches } : {}
            );
          } catch (error) {
            matches.push({
              index: entry.index,
              queriedTabs: 0,
              matchingTabs: 0,
              queryError: String((error && error.message) || error)
            });
            continue;
          }
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
                await runtime.scripting.insertCSS({
                  target,
                  files: [entry.cssFile]
                });
              } catch (error) {}
            }
            try {
              await runtime.scripting.executeScript({
                target,
                files: [entry.jsFile]
              });
              reinjectedTabs += 1;
            } catch (error) {}
          }
        }
        globalThis['${resultKey}'] = JSON.stringify({
          reinjectedTabs,
          hasRuntime: true,
          hasScripting: true,
          entries: payload.length,
          matches
        });
      } catch (error) {
        globalThis['${errorKey}'] = String((error && error.stack) || (error && error.message) || error);
      }
    })();
    return 'started';
  })()`
  const pollExpression = `(() => {
    const r = globalThis['${resultKey}'];
    const e = globalThis['${errorKey}'];
    if (typeof r === 'string' && r.length > 0) return 'OK:' + r;
    if (typeof e === 'string' && e.length > 0) return 'ERR:' + e;
    return '';
  })()`

  function unwrapEvalString(response: unknown): string {
    if (typeof response === 'string') return response
    if (!response || typeof response !== 'object') return ''
    const r = (response as any).result ?? (response as any).value ?? response
    if (typeof r === 'string') return r
    if (r && typeof r === 'object' && typeof (r as any).value === 'string') {
      return (r as any).value
    }
    return ''
  }

  let result: unknown
  try {
    await client.evaluate(target.consoleActor, kickoffExpression)
    // Poll for completion. Each poll is a synchronous eval returning a
    // string ("" until done, "OK:<json>" or "ERR:<msg>" once finished).
    const startedAt = Date.now()
    const timeoutMs = 8000
    let pollResult = ''
    while (Date.now() - startedAt < timeoutMs) {
      const pollResponse = (await client.evaluate(
        target.consoleActor,
        pollExpression
      )) as unknown
      pollResult = unwrapEvalString(pollResponse)
      if (pollResult) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (pollResult.startsWith('OK:')) {
      try {
        result = JSON.parse(pollResult.slice(3))
      } catch {
        result = null
      }
    } else if (pollResult.startsWith('ERR:')) {
      return {
        reinjectedTabs: 0,
        report: {
          phase: 'unavailable',
          reason: `runtime_threw: ${pollResult.slice(4).slice(0, 200)}`,
          addonId
        }
      }
    } else {
      return {
        reinjectedTabs: 0,
        report: {
          phase: 'unavailable',
          reason: 'runtime_timeout',
          addonId
        }
      }
    }
  } catch (error) {
    return {
      reinjectedTabs: 0,
      report: {
        phase: 'unavailable',
        reason: `evaluation_failed: ${String((error as Error)?.message || error)}`,
        addonId
      }
    }
  }

  if (result && typeof result === 'object') {
    const obj = result as {
      reinjectedTabs?: number
      hasRuntime?: boolean
      hasScripting?: boolean
      entries?: number
      matches?: Array<{
        index: number
        queriedTabs: number
        matchingTabs: number
      }>
    }
    const reinjectedTabs = Number(obj.reinjectedTabs) || 0
    const hasRuntime = Boolean(obj.hasRuntime)

    return {
      reinjectedTabs,
      report: {
        phase: hasRuntime ? 'evaluated' : 'unavailable',
        reason: hasRuntime ? undefined : 'no_browser_scripting_in_runtime',
        addonId,
        reinjectedTabs,
        hasRuntime,
        hasScripting: Boolean(obj.hasScripting),
        entries: obj.entries,
        matches: obj.matches
      }
    }
  }

  return {
    reinjectedTabs: 0,
    report: {
      phase: 'unavailable',
      reason: 'unrecognized_result',
      addonId
    }
  }
}
