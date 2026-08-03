//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {sync as spawnSync} from 'cross-spawn'

export interface GitIdentity {
  name?: string
  email?: string
}

function readGitConfig(key: string, cwd: string): string | undefined {
  try {
    const result = spawnSync('git', ['config', '--get', key], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    if (result.status !== 0) return undefined
    const value = String(result.stdout || '').trim()
    return value || undefined
  } catch {
    return undefined
  }
}

// Scaffold metadata carries no author at all. Git identity is read only to
// decide whether the first commit can be made, never to fill in package fields.
export function readGitIdentity(cwd: string = process.cwd()): GitIdentity {
  return {
    name: readGitConfig('user.name', cwd),
    email: readGitConfig('user.email', cwd)
  }
}

export function hasGitIdentity(identity: GitIdentity): boolean {
  return Boolean(identity.name && identity.email)
}
