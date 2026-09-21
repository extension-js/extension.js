// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'

type FsLike = {
  existsSync: (p: string) => boolean
  readFileSync: (p: string, encoding: 'utf-8') => string
}

export const LIBREWOLF_REMOTE_DEBUGGING_LINES = [
  'pref("devtools.debugger.remote-enabled", true);',
  'pref("devtools.debugger.prompt-connection", false);'
]

const OVERRIDES_FILE = 'librewolf.overrides.cfg'

export function librewolfOverridesCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  const home = String(env.HOME || env.USERPROFILE || '').trim()
  const candidates: string[] = []

  if (platform === 'win32') {
    if (home) candidates.push(path.join(home, '.librewolf', OVERRIDES_FILE))

    return candidates
  }

  if (home) candidates.push(path.join(home, '.librewolf', OVERRIDES_FILE))

  const xdg = String(env.XDG_CONFIG_HOME || '').trim()

  if (xdg) {
    candidates.push(path.join(xdg, 'librewolf', 'librewolf', OVERRIDES_FILE))
  }

  if (home) {
    candidates.push(
      path.join(home, '.config', 'librewolf', 'librewolf', OVERRIDES_FILE)
    )
  }

  return candidates
}

// LibreWolf's own config resets the remote-debugging pref to false on every
// start, so only its overrides file can turn the debugger server on.
export function librewolfRemoteDebuggingEnabled(
  fsLike: FsLike,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): {enabled: boolean; expectedPath: string} {
  const candidates = librewolfOverridesCandidates(env, platform)
  const expectedPath =
    candidates[0] || path.join('~', '.librewolf', OVERRIDES_FILE)
  const enabledLine =
    /^\s*(?:pref|defaultPref|lockPref)\(\s*"devtools\.debugger\.remote-enabled"\s*,\s*true\s*\)/m

  for (const candidate of candidates) {
    try {
      if (!fsLike.existsSync(candidate)) continue

      if (enabledLine.test(fsLike.readFileSync(candidate, 'utf-8'))) {
        return {enabled: true, expectedPath: candidate}
      }
    } catch {
      // Ignore
    }
  }

  return {enabled: false, expectedPath}
}
