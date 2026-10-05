//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

type Env = Record<string, string | undefined>

const NPMRC_REGISTRY = /^\s*registry\s*=\s*(.*?)\s*$/
const PUBLIC_REGISTRY_HOSTS = ['registry.npmjs.org', 'registry.yarnpkg.com']

function readEnv(source: Env, name: string): string | undefined {
  const key = Object.keys(source).find(
    (candidate) =>
      candidate.toLowerCase() === name.toLowerCase() && source[candidate]
  )

  return key === undefined ? undefined : source[key]
}

function readNpmrcRegistry(projectDir: string): string | undefined {
  let registry: string | undefined

  try {
    for (const line of fs
      .readFileSync(path.join(projectDir, '.npmrc'), 'utf8')
      .split(/\r?\n/)) {
      const match = NPMRC_REGISTRY.exec(line)
      if (match) registry = match[1].replace(/^(['"])(.*)\1$/, '$2')
    }
  } catch {
    // No .npmrc in the project, so it pins nothing.
  }

  return registry
}

function privateRegistry(value: string | undefined): string | undefined {
  const raw = String(value || '').trim()
  if (!raw || raw.includes('${')) return undefined

  try {
    const url = new URL(raw)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (PUBLIC_REGISTRY_HOSTS.includes(url.hostname)) return undefined

    return url.href.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

// Corepack reads neither .npmrc nor npm_config_registry, only its own
// variable, so a pinned project still fetched its manager from npmjs.org.
export function corepackRegistryEnv(
  source: Env,
  projectDir: string
): Record<string, string> {
  if (readEnv(source, 'COREPACK_NPM_REGISTRY')) return {}

  // The environment outranks the project file, as it does for the manager.
  const registry = privateRegistry(
    readEnv(source, 'npm_config_registry') || readNpmrcRegistry(projectDir)
  )

  return registry ? {COREPACK_NPM_REGISTRY: registry} : {}
}
