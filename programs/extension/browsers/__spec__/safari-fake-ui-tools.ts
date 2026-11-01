// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {readScriptHeader} from '../run-safari/safari-ui/scripts'
import type {
  SafariUiScriptResult,
  SafariUiTools
} from '../run-safari/safari-ui/tools'

export interface FakeSafariState {
  platform: NodeJS.Platform
  accessibility: boolean
  host: string
  unsigned: 0 | 1
  registered: boolean
  enabled: 0 | 1
  otherWebsites: 'Ask' | 'Deny' | 'Allow'
  button: {title: string; tooltip: string; badge: string | null} | null
  menuItems: Array<{title: string; enabled: boolean}>
  shortcut: string | null
  pluginkitFails?: boolean
  scriptFails?: string
  running: boolean
  startsAfterPolls?: number | null
  launchFails?: string
  unsignedSticks?: boolean
  blocker?: string | null
}

export interface FakeSafariUiTools extends SafariUiTools {
  state: FakeSafariState
  calls: string[]
}

function ok(value: unknown): SafariUiScriptResult {
  return {ok: true, code: 0, output: `${JSON.stringify(value)}\n`}
}

export function fakeSafariUiTools(
  overrides: Partial<FakeSafariState> = {}
): FakeSafariUiTools {
  const state: FakeSafariState = {
    platform: 'darwin',
    accessibility: true,
    host: 'Terminal',
    unsigned: 0,
    registered: false,
    enabled: 0,
    otherWebsites: 'Ask',
    button: {title: 'My Ext: off', tooltip: 'My Ext: off', badge: null},
    menuItems: [
      {title: 'Clear list', enabled: true},
      {title: 'Settings', enabled: true}
    ],
    shortcut: '⌥⇧H',
    running: true,
    ...overrides
  }
  const calls: string[] = []

  const listed = () => state.registered && state.unsigned === 1

  const tools: FakeSafariUiTools = {
    state,
    calls,
    platform: state.platform,
    hostApp: () => state.host,
    launchSafari: async () => {
      calls.push('launch')

      if (state.launchFails) {
        return {ok: false, code: 1, output: state.launchFails}
      }

      if (state.startsAfterPolls === undefined) state.running = true

      return ok({})
    },
    pluginkitAdd: async (appexPath) => {
      calls.push(`pluginkit:${appexPath}`)

      if (state.pluginkitFails) {
        return {ok: false, code: 1, output: 'pluginkit: refused'}
      }

      state.registered = true

      return ok({})
    },
    runScript: async (source) => {
      const head = readScriptHeader(source)
      const kind = head?.kind || 'unknown'
      calls.push(`${kind}${head?.action ? `:${head.action}` : ''}`)

      if (!state.accessibility) {
        return {
          ok: false,
          code: 1,
          output:
            'execution error: osascript is not allowed assistive access. (-1719)'
        }
      }

      if (kind === 'probe') return ok({ok: true, elements: 3})

      if (kind === 'running') {
        if (
          !state.running &&
          typeof state.startsAfterPolls === 'number' &&
          calls.includes('launch')
        ) {
          state.startsAfterPolls -= 1
          if (state.startsAfterPolls <= 0) state.running = true
        }

        return ok({ok: true, running: state.running})
      }

      if (kind === 'close') {
        return ok({
          ok: true,
          open: Boolean(state.blocker),
          blocker: state.blocker ?? null
        })
      }

      if (state.scriptFails) {
        return {ok: false, code: 1, output: state.scriptFails}
      }

      switch (kind) {
        case 'unsigned': {
          const before = state.unsigned
          if (head?.action === 'on' && !state.unsignedSticks) state.unsigned = 1

          return ok({
            ok: true,
            before,
            after: state.unsigned,
            clicked: head?.action === 'on' && before === 0,
            blocker: state.unsigned === 1 ? null : (state.blocker ?? null)
          })
        }

        case 'enabled': {
          if (!listed()) {
            return ok({
              ok: true,
              listed: false,
              before: null,
              after: null,
              clicked: false
            })
          }

          const before = state.enabled
          if (head?.action === 'on') state.enabled = 1
          if (head?.action === 'off') state.enabled = 0

          return ok({
            ok: true,
            listed: true,
            before,
            after: state.enabled,
            clicked: before !== state.enabled
          })
        }

        case 'websites': {
          if (!listed()) {
            return ok({ok: true, listed: false, before: null, after: null})
          }

          const before = state.otherWebsites
          if (head?.action === 'allow') state.otherWebsites = 'Allow'

          return ok({
            ok: true,
            listed: true,
            before,
            after: state.otherWebsites
          })
        }

        case 'shortcut':
          return ok({ok: true, listed: listed(), shortcut: state.shortcut})
        case 'button':
          return ok({
            ok: true,
            found: Boolean(state.button),
            button: state.button
              ? {id: head?.id, ...state.button, enabled: true}
              : null
          })
        case 'menu':
          return ok({
            ok: true,
            found: Boolean(state.button),
            opened: Boolean(state.button),
            items: state.button ? state.menuItems : []
          })
        case 'press':
          return ok({ok: true, key: head?.key, modifiers: head?.modifiers})
        default:
          return {ok: false, code: 1, output: `unknown script ${kind}`}
      }
    }
  }

  return tools
}
