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

  let descriptorActor: string | undefined

  try {
    const response = (await client.request({
      to: addonsActor,
      type: 'listAddons'
    })) as ListAddonsResponse

    const match = (response?.addons || []).find(
      (entry) => String(entry?.id || '') === addonId
    )

    descriptorActor =
      typeof match?.actor === 'string' && match.actor ? match.actor : undefined
  } catch {
    return undefined
  }

  if (!descriptorActor) return undefined

  const detail = await client.getTargetFromDescriptor(descriptorActor)
  const consoleActor =
    typeof detail.consoleActor === 'string' ? detail.consoleActor : ''
  const targetActor =
    typeof detail.targetActor === 'string' ? detail.targetActor : ''

  if (!consoleActor) return undefined

  return {
    consoleActor,
    targetActor: targetActor || descriptorActor,
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
  }
): Promise<{reinjectedTabs: number; report: ReinjectionReport}> {
  const {outPath, rules, addonsActor, addonId, matchUrl} = opts

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

  const target = await attachToAddonBackgroundConsole(
    client,
    addonsActor,
    addonId
  )
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

  const expression = `(() => (async () => {
    const payload = ${JSON.stringify(payload)};
    const runtimeApi =
      typeof globalThis === 'object' && globalThis
        ? (globalThis.browser || globalThis.chrome || null)
        : null;
    const runtime =
      runtimeApi && runtimeApi.scripting && runtimeApi.tabs ? runtimeApi : null;
    if (!runtime) {
      return {
        reinjectedTabs: 0,
        hasRuntime: false,
        hasChrome: !!runtimeApi,
        hasScripting: !!(runtimeApi && runtimeApi.scripting),
        hasTabs: !!(runtimeApi && runtimeApi.tabs),
        entries: payload.length,
        matches: []
      };
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
    return {
      reinjectedTabs,
      hasRuntime: true,
      hasScripting: true,
      entries: payload.length,
      matches
    };
  })())()`

  let result: unknown
  try {
    const response = (await client.evaluate(
      target.consoleActor,
      expression
    )) as unknown
    result =
      response && typeof response === 'object' && 'value' in (response as any)
        ? (response as any).value
        : response
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
