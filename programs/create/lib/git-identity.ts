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

/* @invariant The only identity a scaffold may carry is one the machine can
 * prove, which is the identity git will sign the first commit with. When git
 * cannot answer, the field is omitted; a placeholder author reaches a store
 * listing without anyone reading it again. */
export function readGitIdentity(cwd: string = process.cwd()): GitIdentity {
  return {
    name: readGitConfig('user.name', cwd),
    email: readGitConfig('user.email', cwd)
  }
}

export function hasGitIdentity(identity: GitIdentity): boolean {
  return Boolean(identity.name && identity.email)
}
