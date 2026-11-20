// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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

// On macOS each native folder watch closed makes libuv restart the shared
// FSEvents stream and wait for it, which a busy fseventsd stalls for minutes.
// The process exits right after, so the exit drops these handles instead.
export function leaveWatchHandlesToExit(
  options: LeaveWatchHandlesOptions = {}
): number {
  if ((options.platform ?? process.platform) !== 'darwin') return 0

  let left = 0

  for (const candidate of (options.activeHandles ?? readActiveHandles)()) {
    if (!isFolderWatcher(candidate)) continue

    const watcher = candidate

    watcher.close = () => {
      const handle = watcher._handle

      if (!handle) return

      handle.onchange = () => {}

      handle.unref?.()
      leftForExit.add(handle)
      watcher._handle = null
      process.nextTick(() => watcher.emit('close'))
    }

    left++
  }

  return left
}
