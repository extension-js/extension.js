// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import type {IncomingMessage, ServerResponse} from 'node:http'

export const EMULATOR_FILES_PATH = '/__extjs-emulator/files.json'
export const EMULATOR_FILES_VERSION = 1 as const
export const EMULATOR_WIRE_VERSION = '1'
export const DEFAULT_EMULATOR_ORIGIN = 'https://browsers.extension.land'
export const EMULATOR_FILES_WAIT_MS = 10_000
export const EMULATOR_FILES_MAX_WAITERS = 64

export interface EmulatorFileEntry {
  path: string
  size: number
  sha256: string
}

export interface EmulatorFileIndex {
  version: typeof EMULATOR_FILES_VERSION
  instanceId: string
  root: '/'
  livereload?: {path: string}
  files: EmulatorFileEntry[]
}

export function normalizeWebOrigin(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null

  return url.origin
}

export function resolveEmulatorOrigin(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = String(env.EXTENSION_EMULATOR_ORIGIN || '').trim()
  if (!configured) return DEFAULT_EMULATOR_ORIGIN

  const origin = normalizeWebOrigin(configured)

  if (!origin) {
    throw new Error(
      `EXTENSION_EMULATOR_ORIGIN must be an http or https origin, got: ${configured}`
    )
  }

  return origin
}

export function isSameWebOrigin(
  candidate: unknown,
  expected: string | null | undefined
): boolean {
  if (!expected) return false

  const left = normalizeWebOrigin(candidate)
  const right = normalizeWebOrigin(expected)

  return left !== null && left === right
}

export function buildEmulatorViewerUrl(options: {
  origin: string
  host: string
  port: number
  controlPort: number | null
  controlPath: string
  instanceId: string
}): string {
  const host = options.host.includes(':') ? `[${options.host}]` : options.host
  const params = new URLSearchParams()
  params.set('files', `http://${host}:${options.port}${EMULATOR_FILES_PATH}`)

  if (options.controlPort != null) {
    params.set(
      'control',
      `ws://${host}:${options.controlPort}${options.controlPath}`
    )
  }

  params.set('instance', options.instanceId)
  params.set('v', EMULATOR_WIRE_VERSION)

  return `${options.origin}/chromium/#${params.toString()}`
}

export interface EmulatorAssetLike {
  name: string
  source: {buffer(): Buffer}
  info?: {
    hotModuleReplacement?: boolean
    related?: Record<string, string | string[] | undefined>
  }
}

function hotModuleReplacementNames(assets: readonly EmulatorAssetLike[]) {
  const names = new Set<string>()

  for (const asset of assets) {
    if (!asset.info?.hotModuleReplacement) continue

    names.add(asset.name)

    for (const related of Object.values(asset.info.related || {})) {
      for (const name of ([] as Array<string | undefined>).concat(related)) {
        if (name) names.add(name)
      }
    }
  }

  return names
}

function isServableAssetName(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\')) return false

  return !/(?:^|\/)\.\.(?:\/|$)/.test(name)
}

function servedAssetPath(name: string): string {
  return name
    .split('/')
    .filter(
      (segment, index) => segment !== '' && !(segment === '.' && index > 0)
    )
    .join('/')
}

export function buildEmulatorFileIndex(
  assets: Iterable<EmulatorAssetLike>,
  instanceId: string
): EmulatorFileIndex {
  const list = Array.from(assets)
  const hotNames = hotModuleReplacementNames(list)
  const files: EmulatorFileEntry[] = []

  const listed = new Set<string>()

  for (const asset of list) {
    const name = String(asset.name || '')
    if (!isServableAssetName(name) || hotNames.has(name)) continue

    const servedPath = servedAssetPath(name)
    if (!servedPath || listed.has(servedPath)) continue

    listed.add(servedPath)

    const bytes = asset.source.buffer()

    files.push({
      path: servedPath,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {version: EMULATOR_FILES_VERSION, instanceId, root: '/', files}
}

export function resolveLivereloadPath(webSocketServer: unknown): string | null {
  if (!webSocketServer || typeof webSocketServer !== 'object') return null

  const options = (webSocketServer as {options?: {path?: unknown}}).options
  const socketPath = options?.path

  return typeof socketPath === 'string' && socketPath.startsWith('/')
    ? socketPath
    : null
}

export interface EmulatorFileIndexHolder {
  publish(assets: Iterable<EmulatorAssetLike>): EmulatorFileIndex
  reset(): void
  noteCompileFailure(errors: readonly unknown[] | undefined): void
  setLivereloadPath(socketPath: string | null): void
  current(): Promise<EmulatorFileIndex>
  unavailableReason(): string
}

export function emulatorFilesUnavailable(failure: string | null): string {
  return failure
    ? `No file index yet, the last compilation failed: ${failure}`
    : 'No file index yet, no compilation has succeeded.'
}

function firstCompileError(
  errors: readonly unknown[] | undefined
): string | null {
  for (const error of errors || []) {
    const message = (error as {message?: unknown} | null)?.message
    const text = String(message ?? error ?? '').trim()

    if (text) return text.split('\n')[0]
  }

  return null
}

interface IndexWaiter {
  resolve(index: EmulatorFileIndex): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

export function createEmulatorFileIndexHolder(
  instanceId: string,
  options: {waitMs?: number; maxWaiters?: number} = {}
): EmulatorFileIndexHolder {
  const waitMs = options.waitMs ?? EMULATOR_FILES_WAIT_MS
  const maxWaiters = options.maxWaiters ?? EMULATOR_FILES_MAX_WAITERS
  let latest: EmulatorFileIndex | null = null
  let livereloadPath: string | null = null
  let failure: string | null = null
  let waiters: IndexWaiter[] = []

  const withLivereload = (index: EmulatorFileIndex): EmulatorFileIndex =>
    livereloadPath
      ? {
          version: index.version,
          instanceId: index.instanceId,
          root: index.root,
          livereload: {path: livereloadPath},
          files: index.files
        }
      : index

  const settle = (answer: (waiter: IndexWaiter) => void) => {
    const pending = waiters
    waiters = []

    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      answer(waiter)
    }
  }

  return {
    publish(assets) {
      latest = buildEmulatorFileIndex(assets, instanceId)
      failure = null
      const index = withLivereload(latest)
      settle((waiter) => waiter.resolve(index))

      return index
    },
    reset() {
      latest = null
      // A restart drops the index, so a request parked on the old compilation
      // would wait for a publish that is never coming.
      settle((waiter) =>
        waiter.reject(new Error(emulatorFilesUnavailable(failure)))
      )
    },
    noteCompileFailure(errors) {
      failure = firstCompileError(errors)
    },
    setLivereloadPath(socketPath) {
      livereloadPath = socketPath
    },
    unavailableReason() {
      return emulatorFilesUnavailable(failure)
    },
    current() {
      if (latest) return Promise.resolve(withLivereload(latest))

      if (waiters.length >= maxWaiters) {
        return Promise.reject(new Error(emulatorFilesUnavailable(failure)))
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter.timer !== timer)
          reject(new Error(emulatorFilesUnavailable(failure)))
        }, waitMs)
        timer.unref()

        waiters.push({resolve, reject, timer})
      })
    }
  }
}

interface EmulatorCompilerLike {
  hooks?: {
    done?: {
      tap(
        options: {name: string; stage?: number},
        fn: (stats: {
          compilation: {
            errors?: unknown[]
            getAssets(): readonly EmulatorAssetLike[]
          }
        }) => void
      ): void
    }
  }
}

export function attachEmulatorFileIndex(
  compiler: unknown,
  holder: EmulatorFileIndexHolder
) {
  const done = (compiler as EmulatorCompilerLike | undefined)?.hooks?.done
  if (!done) return

  holder.reset()

  done.tap({name: 'extjs-emulator-files', stage: -100}, (stats) => {
    const errors = stats.compilation.errors

    if (errors?.length) {
      holder.noteCompileFailure(errors)

      return
    }

    holder.publish(stats.compilation.getAssets())
  })
}

export function createEmulatorFilesMiddlewareEntry(
  holder: EmulatorFileIndexHolder,
  devServer: unknown,
  viewerOrigin: string | null = resolveEmulatorOrigin()
) {
  const options = (devServer as {options?: {webSocketServer?: unknown}})
    ?.options

  holder.setLivereloadPath(resolveLivereloadPath(options?.webSocketServer))

  return {
    name: 'extjs-emulator-files',
    path: EMULATOR_FILES_PATH,
    middleware: createEmulatorFilesMiddleware(holder, viewerOrigin)
  }
}

export function createEmulatorFilesMiddleware(
  holder: EmulatorFileIndexHolder,
  viewerOrigin: string | null = resolveEmulatorOrigin()
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void
  ) => {
    const method = String(req.method || 'GET').toUpperCase()
    // Only the viewer may read the index: a star handed the file list, and
    // with it every bundle path, to any page the developer had open.
    const allowedOrigin = isSameWebOrigin(req.headers.origin, viewerOrigin)
      ? normalizeWebOrigin(req.headers.origin)
      : null

    res.setHeader('Vary', 'Origin')
    res.setHeader('Cache-Control', 'no-store')

    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }

    if (method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.statusCode = 204
      res.end()

      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      next()

      return
    }

    try {
      const index = await holder.current()
      const body = JSON.stringify(index)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Length', Buffer.byteLength(body))
      res.end(method === 'HEAD' ? undefined : body)
    } catch {
      // The reason comes from the holder, never from the caught value, so a
      // stack or an unexpected throw cannot reach a page on another origin.
      const body = JSON.stringify({error: holder.unavailableReason()})
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Length', Buffer.byteLength(body))
      res.setHeader('Retry-After', '1')
      res.end(method === 'HEAD' ? undefined : body)
    }
  }
}
