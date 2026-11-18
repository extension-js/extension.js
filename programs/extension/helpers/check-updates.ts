//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as os from 'node:os'
import * as path from 'node:path'
import * as semver from 'semver'
import {getCliPackageJson} from './cli-package-json'
import * as messages from './messages'
import {isDebug} from './messaging'

export const UPDATE_CHECK_BOUND_MS = 2000

// Narrower than NodeJS.ProcessEnv, so a test can hand in only what it sets.
type Env = Record<string, string | undefined>

const CACHE_INTERVAL_MS = 60 * 60 * 1000
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'
const ABBREVIATED_PACKUMENT =
  'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'
const COMMANDS_THAT_CHECK = new Set(['dev', 'start', 'preview', 'build'])

export interface UpdateNotice {
  suffix: string
  message: string
}

function isOn(value: string | undefined): boolean {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()

  return v !== '' && v !== '0' && v !== 'false'
}

// Only the commands that print a banner ask, and never for a machine reader.
export function updateCheckWanted({
  command,
  json,
  env
}: {
  command: string | undefined
  json: boolean
  env: Env
}): boolean {
  if (!command || !COMMANDS_THAT_CHECK.has(command)) return false
  if (json) return false

  return !(
    isOn(env.EXTENSION_NO_UPDATE_CHECK) ||
    isOn(env.NO_UPDATE_NOTIFIER) ||
    isOn(env.CI)
  )
}

function expandVariables(value: string, env: Env): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) =>
    String(env[name] ?? '')
  )
}

function registryInUserConfig(
  env: Env,
  homedir: () => string
): string | undefined {
  const file =
    env.npm_config_userconfig ||
    env.NPM_CONFIG_USERCONFIG ||
    path.join(homedir(), '.npmrc')

  let text = ''

  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*registry\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue

    return expandVariables(match[1].replace(/^(['"])(.*)\1$/, '$2'), env)
  }

  return undefined
}

// The registry npm would use, read without starting a package manager. The
// earlier check read npm_registry, so that name still wins when set.
export function resolveRegistry(
  env: Env,
  homedir: () => string = os.homedir
): URL | null {
  const setting =
    env.npm_registry ||
    env.npm_config_registry ||
    env.NPM_CONFIG_REGISTRY ||
    registryInUserConfig(env, homedir) ||
    PUBLIC_REGISTRY

  let url: URL

  try {
    url = new URL(setting)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  // Credentials in the URL would go out as an authorization header.
  url.username = ''
  url.password = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'

  return url
}

// One GET for the CLI's own package. No auth, no user agent, nothing about
// the project. The socket and the timer never hold the process open.
export function lookupLatest(
  name: string,
  registry: URL,
  boundMs: number = UPDATE_CHECK_BOUND_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(encodeURIComponent(name), registry)
    const client = url.protocol === 'https:' ? https : http
    const request = client.get(url, {
      agent: false,
      headers: {accept: ABBREVIATED_PACKUMENT}
    })
    const timer = setTimeout(() => {
      request.destroy(new Error(`No answer from the registry in ${boundMs} ms`))
    }, boundMs)

    timer.unref()
    request.on('socket', (socket) => socket.unref())
    request.on('close', () => clearTimeout(timer))
    request.on('error', reject)
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`The registry answered ${response.statusCode}`))

        return
      }

      let body = ''

      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
      })

      response.on('error', reject)
      response.on('end', () => {
        try {
          const latest = JSON.parse(body)?.['dist-tags']?.latest

          if (typeof latest !== 'string') {
            throw new Error('The registry answer has no latest version')
          }

          resolve(latest)
        } catch (error) {
          reject(error)
        }
      })
    })
  })
}

function cacheFolder(
  env: Env,
  platform: NodeJS.Platform,
  homedir: () => string
): string {
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, 'extensionjs')

  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || env.APPDATA
    if (base) return path.join(base, 'extensionjs', 'Cache')
  }

  if (platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Caches', 'extensionjs')
  }

  return path.join(homedir(), '.cache', 'extensionjs')
}

type CachedAnswers = Record<string, {latest: string; checkedAt: number}>

function readCache(file: string): CachedAnswers {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export interface UpdateCheckDeps {
  env?: Env
  homedir?: () => string
  platform?: NodeJS.Platform
  now?: () => number
  boundMs?: number
  lookup?: typeof lookupLatest
  readPackageJson?: () => {name?: unknown; version?: unknown}
}

function isStableVersion(version: unknown) {
  const v = semver.parse(String(version ?? ''))

  return Boolean(v && v.prerelease.length === 0)
}

async function latestVersion(
  name: string,
  registry: URL,
  {
    env,
    homedir,
    platform,
    now,
    boundMs,
    lookup
  }: Required<Omit<UpdateCheckDeps, 'readPackageJson'>>
): Promise<string> {
  // Keyed by registry, so one registry's answer never stands in for another.
  const key = createHash('sha256').update(registry.href).digest('hex')
  const file = path.join(
    cacheFolder(env, platform, homedir),
    'update-check.json'
  )
  const answers = readCache(file)
  const cached = answers[key]
  const time = now()

  if (
    cached &&
    typeof cached.latest === 'string' &&
    time >= cached.checkedAt &&
    time - cached.checkedAt < CACHE_INTERVAL_MS
  ) {
    return cached.latest
  }

  const latest = await lookup(name, registry, boundMs)

  try {
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(
      file,
      JSON.stringify({...answers, [key]: {latest, checkedAt: time}})
    )
  } catch {
    // A cache that cannot be written only means asking again next time.
  }

  return latest
}

export default async function checkUpdates({
  env = process.env,
  homedir = os.homedir,
  platform = process.platform,
  now = Date.now,
  boundMs = UPDATE_CHECK_BOUND_MS,
  lookup = lookupLatest,
  readPackageJson = getCliPackageJson
}: UpdateCheckDeps = {}): Promise<UpdateNotice | null> {
  const packageJson = readPackageJson()
  const registry = resolveRegistry(env, homedir)

  if (!registry || !isStableVersion(packageJson.version)) return null

  let latest: string

  try {
    latest = await latestVersion(String(packageJson.name), registry, {
      env,
      homedir,
      platform,
      now,
      boundMs,
      lookup
    })
  } catch (err) {
    if (isDebug()) {
      console.error(messages.updateFailed(err))
    }

    return null
  }

  if (!isStableVersion(latest)) return null
  if (!semver.gt(latest, String(packageJson.version))) return null

  return messages.checkUpdates(packageJson as Record<string, unknown>, {
    latest
  })
}
