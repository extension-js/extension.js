// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import {resolveManagedBinaryIn} from '../../browsers-lib/output-binaries-resolver'

// Current Firefox ignores the app.update.enabled pref. The enterprise policy is
// the supported switch, so a managed build cannot update and relaunch itself.
export const MANAGED_GECKO_POLICIES = {DisableAppUpdate: true} as const

export type ManagedUpdatePolicyResult =
  | {status: 'written' | 'present'; policyPath: string}
  | {status: 'skipped'; reason: 'outside-managed-cache' | 'no-install-dir'}
  | {status: 'failed'; policyPath: string; error: string}

type PolicyFs = Pick<
  typeof nodeFs,
  'existsSync' | 'readFileSync' | 'writeFileSync' | 'mkdirSync' | 'renameSync'
>

function pathFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

export function geckoPolicyFilePath(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const p = pathFor(platform)
  const binary = String(binaryPath || '').trim()
  if (!binary) return null

  const resolved = p.resolve(binary)

  if (platform === 'darwin') {
    const segments = resolved.split(p.sep)
    const appIndex = segments.findIndex((segment) => /\.app$/i.test(segment))

    if (appIndex > 0) {
      const appBundle = segments.slice(0, appIndex + 1).join(p.sep)

      return p.join(
        appBundle,
        'Contents',
        'Resources',
        'distribution',
        'policies.json'
      )
    }

    return null
  }

  return p.join(p.dirname(resolved), 'distribution', 'policies.json')
}

export function isInsideManagedCache(
  binaryPath: string,
  managedRoots: string[],
  platform: NodeJS.Platform = process.platform
): boolean {
  const p = pathFor(platform)
  const binary = String(binaryPath || '').trim()
  if (!binary) return false

  const resolvedBinary = p.resolve(binary)

  return managedRoots.some((root) => {
    const trimmed = String(root || '').trim()
    if (!trimmed) return false

    const relative = p.relative(p.resolve(trimmed), resolvedBinary)

    return (
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !p.isAbsolute(relative)
    )
  })
}

function readPolicies(fs: PolicyFs, policyPath: string) {
  if (!fs.existsSync(policyPath)) return {}

  try {
    const parsed = JSON.parse(String(fs.readFileSync(policyPath, 'utf8')))

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function hasManagedPolicies(document: Record<string, unknown>): boolean {
  const policies = document.policies as Record<string, unknown> | undefined
  if (!policies || typeof policies !== 'object') return false

  return Object.entries(MANAGED_GECKO_POLICIES).every(
    ([key, value]) => policies[key] === value
  )
}

export function ensureManagedGeckoUpdatePolicy(opts: {
  binaryPath: string
  managedRoots: string[]
  platform?: NodeJS.Platform
  fs?: PolicyFs
}): ManagedUpdatePolicyResult {
  const platform = opts.platform || process.platform
  const fs = opts.fs || nodeFs

  if (!isInsideManagedCache(opts.binaryPath, opts.managedRoots, platform)) {
    return {status: 'skipped', reason: 'outside-managed-cache'}
  }

  const policyPath = geckoPolicyFilePath(opts.binaryPath, platform)
  if (!policyPath) return {status: 'skipped', reason: 'no-install-dir'}

  try {
    const document = readPolicies(fs, policyPath)
    if (hasManagedPolicies(document)) return {status: 'present', policyPath}

    const existing =
      document.policies && typeof document.policies === 'object'
        ? (document.policies as Record<string, unknown>)
        : {}
    const next = {
      ...document,
      policies: {...existing, ...MANAGED_GECKO_POLICIES}
    }
    const p = pathFor(platform)
    const tempPath = `${policyPath}.${process.pid}.tmp`

    fs.mkdirSync(p.dirname(policyPath), {recursive: true})
    fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    fs.renameSync(tempPath, policyPath)

    return {status: 'written', policyPath}
  } catch (error) {
    return {
      status: 'failed',
      policyPath,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function applyManagedFirefoxInstallPolicy(
  installDir: string,
  cacheRoot: string
): ManagedUpdatePolicyResult {
  let binaryPath: string | null = null

  try {
    binaryPath = resolveManagedBinaryIn(installDir, 'firefox')
  } catch {
    binaryPath = null
  }

  if (!binaryPath) return {status: 'skipped', reason: 'no-install-dir'}

  return ensureManagedGeckoUpdatePolicy({binaryPath, managedRoots: [cacheRoot]})
}
