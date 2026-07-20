// Unit spec for the shared reload seam used by BOTH the launched-browser path
// (BrowsersPlugin) and the --no-browser path (dev server): the single dispatch
// policy + the shared watchRun changed-sources tracker.

import {afterEach, describe, expect, it, vi} from 'vitest'
import type {ReloadInstruction} from '../index'
import {createChangedSourcesTracker, dispatchReload} from '../reload-dispatch'

const CS: ReloadInstruction = {
  type: 'content-scripts',
  changedContentScriptEntries: ['content_scripts/content-0'],
  changedAssets: ['src/content/scripts.js'],
  label: 'content_script (src/content/scripts.js)'
}

afterEach(() => {
  delete process.env.EXTENSION_NO_RELOAD
  vi.restoreAllMocks()
})

describe('dispatchReload', () => {
  // Reload is dispatched through the control-bridge broker (the in-extension SW
  // producer) for BOTH launched (Chromium CDP + Firefox RDP) and `--no-browser`.
  // A launched browser's controller is kept only for logging / source
  // inspection, never reload, so the seam is broker-only.
  it('broadcasts over the broker with the shared label + changed files', async () => {
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}
    await dispatchReload(CS, {broker})
    expect(broker.broadcastReload).toHaveBeenCalledWith({
      type: 'content-scripts',
      changedContentScriptEntries: ['content_scripts/content-0'],
      label: 'content_script (src/content/scripts.js)',
      changedFiles: ['src/content/scripts.js']
    })
  })

  it('prints the stdout "Reloading …" line only when a producer was notified', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    // 0 producers → nothing actually reloads → no line.
    await dispatchReload(CS, {
      broker: {broadcastReload: vi.fn().mockReturnValue(0)}
    })
    expect(log).not.toHaveBeenCalled()

    // ≥1 producer → the one shared label is announced.
    await dispatchReload(CS, {
      broker: {broadcastReload: vi.fn().mockReturnValue(1)}
    })
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain(
      'content_script (src/content/scripts.js)'
    )
  })

  // §53: a reload that reaches zero producers is a silent no-op, on heavy
  // sites / auth walls where the SW never attaches, that looks like a broken
  // tool. The broker hands back a single deduped hint; dispatch surfaces it.
  it('warns with the broker hint when a reload reaches zero producers (§53)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {
      broadcastReload: vi.fn().mockReturnValue(0),
      undeliveredReloadWarning: vi.fn().mockReturnValue('SW not attached, …')
    }
    await dispatchReload(CS, {broker})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('SW not attached')
    // No "Reloading…" line when nothing was reloaded.
    expect(log).not.toHaveBeenCalled()
  })

  it('stays silent when zero producers but the broker returns no hint (§53 grace/dedup)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broker = {
      broadcastReload: vi.fn().mockReturnValue(0),
      undeliveredReloadWarning: vi.fn().mockReturnValue(null)
    }
    await dispatchReload(CS, {broker})
    expect(warn).not.toHaveBeenCalled()
  })

  it('does NOT ask for an undelivered-reload hint when a producer was notified (§53)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const undeliveredReloadWarning = vi.fn().mockReturnValue('should not show')
    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        undeliveredReloadWarning
      }
    })
    expect(undeliveredReloadWarning).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('is a no-op for an undefined instruction (no changed sources)', async () => {
    const broker = {broadcastReload: vi.fn()}
    await dispatchReload(undefined, {broker})
    expect(broker.broadcastReload).not.toHaveBeenCalled()
  })

  it('is a no-op when no broker is present', async () => {
    // Nothing to dispatch to, must not throw.
    await expect(dispatchReload(CS, {})).resolves.toBeUndefined()
  })

  it('honors EXTENSION_NO_RELOAD', async () => {
    process.env.EXTENSION_NO_RELOAD = 'true'
    const broker = {broadcastReload: vi.fn()}
    await dispatchReload(CS, {broker})
    expect(broker.broadcastReload).not.toHaveBeenCalled()
  })
})

describe('createChangedSourcesTracker', () => {
  function fakeCompiler() {
    let runner: (() => void) | undefined
    const compiler: any = {
      modifiedFiles: undefined as Set<string> | undefined,
      options: {context: '/proj'},
      hooks: {
        watchRun: {
          tap: (_name: string, fn: () => void) => {
            runner = fn
          }
        }
      }
    }
    return {compiler, fireWatchRun: () => runner?.()}
  }

  it('records project-relative, forward-slashed changed sources', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/src/content/scripts.js'])
    fireWatchRun()
    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/content/scripts.js']
    })
  })

  it('drops the watch root itself (relativizes to empty) from changed sources', () => {
    // rspack sometimes reports the project dir as a modified "file"; it must
    // not leak into the reload label as a dangling comma.
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj', '/proj/src/content/scripts.js'])
    fireWatchRun()
    expect(tracker.snapshot().changedSources).toEqual([
      'src/content/scripts.js'
    ])
  })

  it('forces a full reload for a manifest.json or _locales change', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set([
      '/proj/src/manifest.json',
      '/proj/src/popup/index.js'
    ])
    fireWatchRun()
    expect(tracker.snapshot().forcedFull).toBe(true)

    compiler.modifiedFiles = new Set(['/proj/src/_locales/en/messages.json'])
    fireWatchRun()
    expect(tracker.snapshot().forcedFull).toBe(true)
  })

  it('resets on each watchRun (no stale carryover)', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/src/manifest.json'])
    fireWatchRun()
    expect(tracker.snapshot().forcedFull).toBe(true)

    // A subsequent compile with no modified files clears the prior state.
    compiler.modifiedFiles = new Set()
    fireWatchRun()
    expect(tracker.snapshot()).toEqual({forcedFull: false, changedSources: []})
  })
})
