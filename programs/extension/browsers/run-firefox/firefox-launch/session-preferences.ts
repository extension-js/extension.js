// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

const SESSION_START =
  '// Extension.js session preferences, removed when the session ends'
const SESSION_END = '// End of Extension.js session preferences'

// The debugger server only listens with these on, and the add-on install
// travels over that server, so a profile without them loads nothing.
export const REMOTE_DEBUGGING_PREFERENCES: Record<string, unknown> = {
  'devtools.chrome.enabled': true,
  'devtools.debugger.prompt-connection': false,
  'devtools.debugger.remote-enabled': true
}

function serializeValue(value: unknown): string {
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)

  return JSON.stringify(value)
}

export function serializeUserJs(prefs: Record<string, unknown>): string {
  return Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${serializeValue(value)});`
    )
    .join('\n')
}

function withoutSessionBlock(content: string): string {
  const start = content.indexOf(SESSION_START)
  if (start === -1) return content

  const end = content.indexOf(SESSION_END, start)
  if (end === -1) return content.slice(0, start)

  const tail = content.slice(end + SESSION_END.length)

  return content.slice(0, start) + tail.replace(/^\r?\n/, '')
}

// A profile the developer owns keeps its user.js: the session block is
// appended after their lines and taken back out byte for byte afterwards.
export function addSessionPreferences(
  profilePath: string,
  prefs: Record<string, unknown>
): void {
  const userJsPath = path.join(profilePath, 'user.js')
  const own = fs.existsSync(userJsPath)
    ? withoutSessionBlock(fs.readFileSync(userJsPath, 'utf8'))
    : ''

  fs.writeFileSync(
    userJsPath,
    `${own}${SESSION_START}\n${serializeUserJs(prefs)}\n${SESSION_END}\n`
  )
}

export function removeSessionPreferences(profilePath: string): void {
  try {
    const userJsPath = path.join(profilePath, 'user.js')
    if (!fs.existsSync(userJsPath)) return

    const content = fs.readFileSync(userJsPath, 'utf8')
    if (!content.includes(SESSION_START)) return

    const own = withoutSessionBlock(content)

    if (own) {
      fs.writeFileSync(userJsPath, own)
    } else {
      fs.rmSync(userJsPath, {force: true})
    }
  } catch {
    // best-effort; the next launch replaces a block left behind
  }
}
