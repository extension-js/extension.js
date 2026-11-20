import {EventEmitter} from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {setupCleanupHandlers} from '../cleanup'
import {leaveWatchHandlesToExit} from '../leave-watch-handles-to-exit'
import type {PortManager} from '../port-manager'

interface NativeHandle {
  close: () => void
  hasRef: () => boolean
}

const roots: string[] = []
const nativeHandles: NativeHandle[] = []

afterEach(() => {
  vi.restoreAllMocks()

  // Closed for real here, so the test process keeps no watch behind.
  while (nativeHandles.length) {
    try {
      nativeHandles.pop()?.close()
    } catch {
      // Already closed by a row that kept the native close.
    }
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

function openWatchers() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-leave-watch-'))
  roots.push(root)
  const events: string[] = []
  // Linux runs a recursive watch in JavaScript, with no native handle.
  const recursive = process.platform !== 'linux'
  const watchers = [
    fs.watch(root, {recursive}, (_type, name) => events.push(`r:${name}`)),
    fs.watch(root, (_type, name) => events.push(`d:${name}`))
  ]
  const handles = watchers.map(
    (watcher) => (watcher as unknown as {_handle: NativeHandle})._handle
  )
  nativeHandles.push(...handles)

  return {root, events, watchers, handles}
}

describe('leaveWatchHandlesToExit', () => {
  it('finds open folder watchers where the exit path reads them', () => {
    const {watchers} = openWatchers()
    const active = (
      process as unknown as {_getActiveHandles: () => unknown[]}
    )._getActiveHandles()

    for (const watcher of watchers) expect(active).toContain(watcher)
  })

  it('closes a macOS folder watcher without the native teardown', async () => {
    const {root, events, watchers, handles} = openWatchers()
    const nativeCloses = handles.map((handle) => vi.spyOn(handle, 'close'))
    const closed = vi.fn()

    for (const watcher of watchers) watcher.on('close', closed)

    expect(
      leaveWatchHandlesToExit({
        platform: 'darwin',
        activeHandles: () => [...watchers, {}, null]
      })
    ).toBe(2)

    for (const watcher of watchers) {
      watcher.close()
      watcher.close()
    }

    await new Promise((resolve) => process.nextTick(resolve))

    for (const nativeClose of nativeCloses) {
      expect(nativeClose).not.toHaveBeenCalled()
    }

    expect(closed).toHaveBeenCalledTimes(2)
    for (const handle of handles) expect(handle.hasRef()).toBe(false)

    // A write after the close reaches no listener.
    fs.writeFileSync(path.join(root, 'late.txt'), 'late')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(events).toEqual([])
  })

  it('leaves the native close alone off macOS', () => {
    const {watchers, handles} = openWatchers()
    const nativeCloses = handles.map((handle) => vi.spyOn(handle, 'close'))

    expect(
      leaveWatchHandlesToExit({
        platform: 'linux',
        activeHandles: () => watchers
      })
    ).toBe(0)

    for (const watcher of watchers) watcher.close()

    for (const nativeClose of nativeCloses) {
      expect(nativeClose).toHaveBeenCalledTimes(1)
    }
  })
})

describe('dev shutdown and folder watchers', () => {
  it('leaves the watch handles to the exit before the server stops', async () => {
    const order: string[] = []
    const events = new EventEmitter()
    const stop = vi.fn(async () => {
      order.push('stop')
    })
    const portManager = {
      terminateCurrentInstance: vi.fn(async () => {})
    } as unknown as PortManager

    const dispose = setupCleanupHandlers(
      () => ({stop}) as never,
      portManager,
      undefined,
      {
        events,
        env: {},
        exit: () => order.push('exit'),
        print: () => {},
        leaveWatchHandles: () => {
          order.push('leave')
        }
      }
    )

    try {
      events.emit('SIGINT', 'SIGINT')
      await vi.waitFor(() => expect(order).toContain('exit'), {timeout: 5000})
      expect(order).toEqual(['leave', 'stop', 'exit'])
    } finally {
      dispose()
    }
  })
})
