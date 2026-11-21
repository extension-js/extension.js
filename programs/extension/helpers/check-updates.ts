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
const BOUND_STEP_MS = 100

// Narrower than NodeJS.ProcessEnv, so a test can hand in only what it sets.
type Env = Record<string, string | undefined>

const CACHE_INTERVAL_MS = 60 * 60 * 1000
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'
// The dist-tag document is a few kilobytes, the full package document is
// hundreds and grows with every release. Anything past this cap is refused.
const MAX_ANSWER_BYTES = 1024 * 1024
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
  terminal,
  env
}: {
  command: string | undefined
  json: boolean
  // Whether stderr is a terminal, where a person reads the notice.
  terminal: boolean
  env: Env
}): boolean {
  if (!command || !COMMANDS_THAT_CHECK.has(command)) return false
  if (json) return false
  // A script that pipes the run never reads a notice, nor waits on a registry.
  if (!terminal) return false

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

// One GET for the latest dist-tag of the CLI's own package. No auth, no user
// agent, nothing about the project. Socket and timer never hold the process.
export function lookupLatest(
  name: string,
  registry: URL,
  boundMs: number = UPDATE_CHECK_BOUND_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${encodeURIComponent(name)}/latest`, registry)
    const client = url.protocol === 'https:' ? https : http
    const request = client.get(url, {
      agent: false,
      headers: {accept: 'application/json'}
    })
    // Counted in short steps: a stretch where this process kept the event
    // loop busy, as loading the commands does, uses up one step and no more.
    const stepMs = Math.min(BOUND_STEP_MS, boundMs)
    let leftMs = boundMs
    let timer: NodeJS.Timeout

    const step = () => {
      leftMs -= stepMs

      if (leftMs <= 0) {
        request.destroy(
          new Error(`No answer from the registry in ${boundMs} ms`)
        )

        return
      }

      timer = setTimeout(step, Math.min(stepMs, leftMs))
      timer.unref()
    }

    timer = setTimeout(step, stepMs)
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

      const chunks: Buffer[] = []
      let received = 0

      response.on('data', (chunk: Buffer) => {
        received += chunk.length

        if (received > MAX_ANSWER_BYTES) {
          const tooLarge = new Error('The registry answer is over 1 MB')

          reject(tooLarge)
          request.destroy(tooLarge)

          return
        }

        chunks.push(chunk)
      })

      response.on('error', reject)
      response.on('end', () => {
        try {
          const latest = JSON.parse(
            Buffer.concat(chunks).toString('utf8')
          )?.version

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

export interface SettleTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (timer: unknown) => void
}

const processTimers: SettleTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer as NodeJS.Timeout)
}

export interface SettleSignals {
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  removeListener(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

// The lookup never holds the process, so a command that ends first would
// drop its answer. This holds the run until the check settles, or the bound.
export function settleUpdateCheck(
  pending: Promise<unknown>,
  boundMs: number = UPDATE_CHECK_BOUND_MS,
  timers: SettleTimers = processTimers,
  signals: SettleSignals = process
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      timers.clear(timer)
      signals.removeListener('SIGINT', done)
      signals.removeListener('SIGTERM', done)
      resolve()
    }

    const timer = timers.set(done, boundMs)

    // The command is over and told. A signal ends the wait, not the command.
    signals.once('SIGINT', done)
    signals.once('SIGTERM', done)
    pending.then(done, done)
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

// A miss carries no latest, so a reader that only knows answers asks again.
type CachedAnswers = Record<
  string,
  {latest?: string; missed?: boolean; checkedAt: number}
>

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
): Promise<string | null> {
  // Keyed by registry, so one registry's answer never stands in for another.
  const key = createHash('sha256').update(registry.href).digest('hex')
  const file = path.join(
    cacheFolder(env, platform, homedir),
    'update-check.json'
  )
  const answers = readCache(file)
  const cached = answers[key]
  const time = now()
  const fresh =
    cached &&
    time >= cached.checkedAt &&
    time - cached.checkedAt < CACHE_INTERVAL_MS

  if (fresh && typeof cached.latest === 'string') return cached.latest
  if (fresh && cached.missed === true) return null

  const keep = (entry: CachedAnswers[string]) => {
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, JSON.stringify({...answers, [key]: entry}))
    } catch {
      // A cache that cannot be written only means asking again next time.
    }
  }

  let latest: string

  try {
    latest = await lookup(name, registry, boundMs)
  } catch (err) {
    // A silent registry costs the bound, so it is not asked again for an hour.
    keep({missed: true, checkedAt: time})

    throw err
  }

  keep({latest, checkedAt: time})

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

  let latest: string | null

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

  if (latest === null || !isStableVersion(latest)) return null
  if (!semver.gt(latest, String(packageJson.version))) return null

  return messages.checkUpdates(packageJson as Record<string, unknown>, {
    latest
  })
}
