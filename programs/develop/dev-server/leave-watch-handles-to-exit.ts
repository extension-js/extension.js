// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance
import * as fs from 'node:fs'

interface NativeWatchHandle {
  onchange?: unknown
  unref?: () => void
}

interface FolderWatcher {
  _handle?: NativeWatchHandle | null
  close: () => void
  emit: (event: string) => boolean
}

export interface LeaveWatchHandlesOptions {
  platform?: NodeJS.Platform
  activeHandles?: () => unknown[]
}

// Held so a handle the watcher let go of is not collected before the exit.
const leftForExit = new Set<NativeWatchHandle>()

function readActiveHandles(): unknown[] {
  const reader = (process as {_getActiveHandles?: () => unknown[]})
    ._getActiveHandles

  return typeof reader === 'function' ? reader.call(process) : []
}

function isFolderWatcher(value: unknown): value is FolderWatcher {
  const candidate = value as Partial<FolderWatcher> | null

  return (
    candidate?.constructor?.name === 'FSWatcher' &&
    typeof candidate.close === 'function' &&
    typeof candidate.emit === 'function' &&
    '_handle' in candidate
  )
}

// What close becomes: the handle stops calling back and is dropped for the
// exit to reclaim, and the watcher still says it closed.
function leaveToExit(watcher: FolderWatcher): void {
  const handle = watcher._handle

  if (!handle) return

  handle.onchange = () => {}

  handle.unref?.()
  leftForExit.add(handle)
  watcher._handle = null
  process.nextTick(() => watcher.emit('close'))
}

// A file watch rides kqueue, so opening and closing this one costs nothing,
// and it shares its class with every folder watcher of the process.
function watcherPrototype(found: FolderWatcher | undefined): object | null {
  if (found) return Object.getPrototypeOf(found)

  const probe = fs.watch(process.execPath, {persistent: false})
  const prototype = Object.getPrototypeOf(probe)

  probe.close()

  return prototype
}

// The list of active handles leaves out a watcher that does not keep the
// process alive and one opened later, and the class reaches both.
function leaveEveryLaterCloseToExit(found: FolderWatcher | undefined): void {
  const prototype = watcherPrototype(found) as {
    close?: (this: FolderWatcher) => void
  } | null

  if (!prototype || typeof prototype.close !== 'function') return

  prototype.close = function close(this: FolderWatcher) {
    leaveToExit(this)
  }
}

// On macOS each native folder watch closed makes libuv restart the shared
// FSEvents stream and wait for it, which a busy fseventsd stalls for minutes.
// The process exits right after, so the exit drops these handles instead.
export function leaveWatchHandlesToExit(
  options: LeaveWatchHandlesOptions = {}
): number {
  if ((options.platform ?? process.platform) !== 'darwin') return 0

  let left = 0
  let found: FolderWatcher | undefined

  for (const candidate of (options.activeHandles ?? readActiveHandles)()) {
    if (!isFolderWatcher(candidate)) continue

    const watcher = candidate

    found ??= watcher
    watcher.close = () => leaveToExit(watcher)
    left++
  }

  try {
    leaveEveryLaterCloseToExit(found)
  } catch {
    // The watchers found above are still left, the rest close natively.
  }

  return left
}
