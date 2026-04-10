// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {appendFileSync, existsSync, mkdirSync} from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'

import * as messages from '../../../browsers-lib/messages'
import {MessagingClient} from './messaging-client'

const TARGET_SCAN_INTERVAL_MS = 250

function guessRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir)
  // Prefer the Extension.js monorepo root (avoids nested workspaces like _FUTURE/examples).
  for (let depth = 0; depth < 24; depth++) {
    if (existsSync(path.join(dir, 'programs', 'develop', 'package.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  dir = path.resolve(startDir)
  for (let depth = 0; depth < 16; depth++) {
    if (
      existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      existsSync(path.join(dir, '.git'))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

/**
 * Dev server cwd is often a subfolder or unrelated to the repo; this file's path
 * still lives under extension-develop and walks up to the workspace root.
 */
function guessRepoRootFromThisModule(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return guessRepoRoot(here)
  } catch {
    return null
  }
}

function appendDebugLogLine(line: string) {
  const paths: string[] = []
  const fromEnv = process.env.EXTENSION_DEBUG_SESSION_LOG
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    paths.push(fromEnv)
  }
  const repoFromModule = guessRepoRootFromThisModule()
  if (repoFromModule) {
    paths.push(path.join(repoFromModule, '.cursor', 'debug-a87efc.log'))
  }
  const repoFromCwd = guessRepoRoot(process.cwd())
  if (repoFromCwd) {
    paths.push(path.join(repoFromCwd, '.cursor', 'debug-a87efc.log'))
  }
  for (const root of [
    process.env.INIT_CWD,
    process.env.PROJECT_ROOT,
    process.cwd()
  ]) {
    if (typeof root === 'string' && root.length > 0) {
      paths.push(path.join(root, '.cursor', 'debug-a87efc.log'))
    }
  }
  const seen = new Set<string>()
  for (const filePath of paths) {
    if (seen.has(filePath)) {
      continue
    }
    seen.add(filePath)
    try {
      mkdirSync(path.dirname(filePath), {recursive: true})
      appendFileSync(filePath, `${line}\n`)
      return
    } catch {
      // try next candidate root
    }
  }
  // #region agent log
  console.error(
    '[extension-develop][debug-session a87efc] log file write failed',
    line
  )
  // #endregion
}

function agentDebugLog(payload: Record<string, unknown>) {
  const line = JSON.stringify({
    sessionId: 'a87efc',
    timestamp: Date.now(),
    ...payload
  })
  fetch('http://127.0.0.1:7795/ingest/9eb8f923-a325-4455-a46c-a6e706558307', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'a87efc'
    },
    body: line
  }).catch(() => {})
  appendDebugLogLine(line)
}

/** When we intend to inspect a real document URL, never bind to an unrelated tab (e.g. about:blank) while the target list is still catching up after navigation. */
function shouldDeferFallbackUntilExactMatch(normalizedUrl: string): boolean {
  try {
    const parsed = new URL(String(normalizedUrl || ''))
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'file:' ||
      parsed.protocol === 'moz-extension:' ||
      parsed.protocol === 'chrome-extension:' ||
      parsed.protocol === 'edge:'
    )
  } catch {
    return false
  }
}

/**
 * When listTabs still reports about:blank but navigation already finished, match by live document URL.
 */
async function findActorsMatchingLiveHref(
  client: MessagingClient,
  allTargets: Array<{
    url?: string
    actor?: string
    consoleActor?: string
  }>,
  normalizedUrlToInspect: string
): Promise<{tabActor: string; consoleActor: string} | null> {
  const withActor = allTargets.filter((t) => t && typeof t.actor === 'string')
  for (let i = withActor.length - 1; i >= 0; i--) {
    const target = withActor[i]
    const tabActor = String(target.actor)
    let consoleActor: string | undefined =
      typeof target.consoleActor === 'string' && target.consoleActor.length > 0
        ? target.consoleActor
        : undefined
    if (!consoleActor || consoleActor === tabActor) {
      try {
        const detail = await client.getTargetFromDescriptor(tabActor)
        if (
          typeof detail.consoleActor === 'string' &&
          detail.consoleActor.length > 0
        ) {
          consoleActor = detail.consoleActor
        }
      } catch {
        // ignore
      }
    }
    if (!consoleActor) {
      continue
    }
    try {
      const hrefRaw = await client.evaluate(
        consoleActor,
        'String(location.href || "")'
      )
      const href = typeof hrefRaw === 'string' ? hrefRaw : String(hrefRaw ?? '')
      if (normalizeInspectableUrl(href) === normalizedUrlToInspect) {
        return {tabActor, consoleActor}
      }
    } catch {
      // ignore
    }
  }
  return null
}

function normalizeInspectableUrl(rawUrl: string): string {
  try {
    const parsed = new URL(String(rawUrl || ''))
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.pathname === '/'
    ) {
      parsed.pathname = ''
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return String(rawUrl || '')
      .trim()
      .replace(/\/$/, '')
  }
}

export async function selectActors(
  client: MessagingClient,
  urlToInspect: string
): Promise<{tabActor: string; consoleActor: string}> {
  const deadline = Date.now() + 10000
  let triedAddTab = false
  const normalizedUrlToInspect = normalizeInspectableUrl(urlToInspect)

  while (Date.now() < deadline) {
    const allTargets =
      ((await client.getTargets()) as unknown as Array<{
        url?: string
        type?: string
        outerWindowId?: number
        outerWindowID?: number
        actor?: string
        consoleActor?: string
      }>) || []

    // 1) Exact URL match.
    // Prefer the newest matching tab when duplicate URLs exist.
    const exactMatches = allTargets.filter(
      (target) =>
        target &&
        typeof target.url === 'string' &&
        normalizeInspectableUrl(target.url) === normalizedUrlToInspect &&
        target.actor
    )
    const exactMatch =
      exactMatches.length > 0
        ? exactMatches[exactMatches.length - 1]
        : undefined
    if (exactMatch?.actor) {
      const matchDiagnostics = []
      for (const target of exactMatches.slice(-5)) {
        const actor = String(target.actor || '')
        const consoleActor = String(target.consoleActor || actor)
        let hostCount: number | undefined
        let href: string | undefined
        try {
          const probe = await client.evaluate(
            consoleActor,
            `(() => JSON.stringify({
              href: String(location.href || ''),
              readyState: String(document.readyState || ''),
              hostCount: document.querySelectorAll('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])').length
            }))()`
          )
          if (typeof probe === 'string' && probe) {
            const parsed = JSON.parse(probe)
            hostCount =
              typeof parsed?.hostCount === 'number'
                ? parsed.hostCount
                : undefined
            href = typeof parsed?.href === 'string' ? parsed.href : undefined
          }
        } catch {
          // Ignore diagnostics failures.
        }
        matchDiagnostics.push({
          actor,
          consoleActor,
          url: target.url || '',
          href,
          hostCount
        })
      }
      // #region agent log
      agentDebugLog({
        runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-select-actors',
        hypothesisId: 'H20',
        location: 'setup-firefox-inspection-actors.ts:exact-match-selection',
        message: 'Firefox exact URL match selection diagnostics',
        data: {
          urlToInspect,
          selectedActor: exactMatch.actor,
          selectedConsoleActor: exactMatch.consoleActor || exactMatch.actor,
          matchDiagnostics
        }
      })
      // #endregion
      return {
        tabActor: exactMatch.actor,
        consoleActor: exactMatch.consoleActor || exactMatch.actor
      }
    }

    // 1b) Live document URL (listTabs URL can lag behind navigation).
    if (shouldDeferFallbackUntilExactMatch(normalizedUrlToInspect)) {
      const livePair = await findActorsMatchingLiveHref(
        client,
        allTargets,
        normalizedUrlToInspect
      )
      if (livePair) {
        let hostCount: number | undefined
        let href: string | undefined
        try {
          const probe = await client.evaluate(
            livePair.consoleActor,
            `(() => JSON.stringify({
              href: String(location.href || ''),
              readyState: String(document.readyState || ''),
              hostCount: document.querySelectorAll('#extension-root,[data-extension-root]:not([data-extension-root="extension-js-devtools"])').length
            }))()`
          )
          if (typeof probe === 'string' && probe) {
            const parsed = JSON.parse(probe)
            hostCount =
              typeof parsed?.hostCount === 'number'
                ? parsed.hostCount
                : undefined
            href = typeof parsed?.href === 'string' ? parsed.href : undefined
          }
        } catch {
          // Ignore diagnostics failures.
        }
        // #region agent log
        agentDebugLog({
          runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-select-actors',
          hypothesisId: 'H23',
          location: 'setup-firefox-inspection-actors.ts:live-href-match',
          message:
            'Firefox actor matched by live location.href (listTabs URL was stale)',
          data: {
            urlToInspect,
            selectedActor: livePair.tabActor,
            selectedConsoleActor: livePair.consoleActor,
            href,
            hostCount
          }
        })
        // #endregion
        return livePair
      }
    }

    // 2) Try to open the tab once if no match yet
    if (!triedAddTab && urlToInspect) {
      triedAddTab = true
      try {
        await client.addTab(urlToInspect)
        await new Promise((resolve) => setTimeout(resolve, 300))
        continue
      } catch (error) {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          const msg =
            (error as {message?: string} | undefined)?.message || String(error)
          console.warn(messages.rdpAddTabFailed(msg))
        }
      }
    }

    // 3) Fallback to first valid target with an actor — only when we are not waiting
    // for a specific navigated document. Otherwise keep scanning until an exact URL match
    // or the deadline (avoids binding to about:blank while example.com is still loading).
    if (!shouldDeferFallbackUntilExactMatch(normalizedUrlToInspect)) {
      for (const target of allTargets) {
        if (
          target &&
          (typeof target.actor === 'string' ||
            typeof target.outerWindowID === 'number' ||
            typeof target.outerWindowId === 'number')
        ) {
          // #region agent log
          agentDebugLog({
            runId: process.env.EXTENSION_INSTANCE_ID || 'firefox-select-actors',
            hypothesisId: 'H21',
            location: 'setup-firefox-inspection-actors.ts:fallback-selection',
            message: 'Firefox actor selection fell back to first valid target',
            data: {
              urlToInspect,
              selectedActor: String(target.actor || ''),
              selectedConsoleActor: String(
                target.consoleActor || target.actor || ''
              ),
              targets: allTargets.slice(0, 10).map((item, index) => ({
                index,
                actor: String(item?.actor || ''),
                consoleActor: String(item?.consoleActor || ''),
                url: String(item?.url || ''),
                outerWindowID:
                  typeof item?.outerWindowID === 'number'
                    ? item.outerWindowID
                    : undefined,
                outerWindowId:
                  typeof item?.outerWindowId === 'number'
                    ? item.outerWindowId
                    : undefined
              }))
            }
          })
          // #endregion
          return {
            tabActor: String(target.actor || ''),
            consoleActor: String(target.consoleActor || target.actor || '')
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, TARGET_SCAN_INTERVAL_MS))
  }

  throw new Error(messages.sourceInspectorNoTabTargetFound())
}
