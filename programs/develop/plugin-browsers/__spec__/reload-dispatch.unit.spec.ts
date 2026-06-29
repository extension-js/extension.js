// Unit spec for the shared reload seam used by BOTH the launched-browser path
// (BrowsersPlugin) and the --no-browser path (dev server): the single dispatch
// policy + the shared watchRun changed-sources tracker.

import {afterEach, describe, expect, it, vi} from 'vitest'
import type {ReloadInstruction} from '../index'
import {createChangedSourcesTracker, dispatchReload} from '../reload-dispatch'

const CS: ReloadInstruction = {
  type: 'content-scripts',
  changedContentScriptEntries: ['content_scripts/content-0'],
  changedAssets: ['src/content/scripts.js']
}

afterEach(() => {
  delete process.env.EXTENSION_NO_RELOAD
})

describe('dispatchReload', () => {
  // Reload is dispatched through the control-bridge broker (the in-extension SW
  // producer) for BOTH launched (Chromium CDP + Firefox RDP) and `--no-browser`.
  // A launched browser's controller is kept only for logging / source
  // inspection, never reload — so the seam is broker-only.
  it('broadcasts over the broker', async () => {
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}
    await dispatchReload(CS, {broker})
    expect(broker.broadcastReload).toHaveBeenCalledWith({
      type: 'content-scripts',
      changedContentScriptEntries: ['content_scripts/content-0']
    })
  })

  it('is a no-op for an undefined instruction (page-only edit)', async () => {
    const broker = {broadcastReload: vi.fn()}
    await dispatchReload(undefined, {broker})
    expect(broker.broadcastReload).not.toHaveBeenCalled()
  })

  it('is a no-op when no broker is present', async () => {
    // Nothing to dispatch to — must not throw.
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
