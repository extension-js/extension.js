import {describe, expect, it, vi} from 'vitest'

import {BrowsersPlugin} from '../index'

// Reach the private retry directly: the done hook needs a whole rspack
// compiler, and the gate itself is what must never misfire.
const retryOn = (plugin: BrowsersPlugin, controller: unknown) => {
  ;(plugin as unknown as {controller: unknown}).controller = controller
  return (
    plugin as unknown as {
      retryRefusedExtensionLoad: () => Promise<boolean>
    }
  ).retryRefusedExtensionLoad()
}

const makePlugin = () =>
  new BrowsersPlugin({
    launcher: vi.fn(),
    browserOptions: {browser: 'chrome'}
  } as never)

describe('retryRefusedExtensionLoad (§84)', () => {
  // The regression that matters: loadUnpacked RESTARTS an already-loaded
  // extension, so a healthy session must never reach the retry.
  it('never re-asks a browser that is not refusing', async () => {
    const retryExtensionLoad = vi.fn()
    const controller = {
      enableUnifiedLogging: vi.fn(),
      getExtensionLoadRefusal: () => null,
      retryExtensionLoad
    }

    await expect(retryOn(makePlugin(), controller)).resolves.toBe(false)
    expect(retryExtensionLoad).not.toHaveBeenCalled()
  })

  it('reports recovery once the browser accepts the dist', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const controller = {
      enableUnifiedLogging: vi.fn(),
      getExtensionLoadRefusal: () => 'Variable $2$ used but not defined.',
      retryExtensionLoad: vi.fn(async () => ({status: 'loaded' as const}))
    }

    await expect(retryOn(makePlugin(), controller)).resolves.toBe(true)
    expect(log.mock.calls.join(' ')).toContain('accepted the extension')
    log.mockRestore()
  })

  // The operator just changed something, so a repeat refusal must show the
  // browser's CURRENT answer rather than replaying the launch-time one.
  it("prints the browser's new reason when it still refuses", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = {
      enableUnifiedLogging: vi.fn(),
      getExtensionLoadRefusal: () => 'old reason',
      retryExtensionLoad: vi.fn(async () => ({
        status: 'refused' as const,
        reason: 'Could not load theme/images/missing.png.'
      }))
    }

    await expect(retryOn(makePlugin(), controller)).resolves.toBe(false)
    const printed = error.mock.calls.join(' ')
    expect(printed).toContain('Could not load theme/images/missing.png.')
    expect(printed).not.toContain('old reason')
    error.mockRestore()
  })

  // The dist can recompile several times before the fix lands in it. Repeating
  // the same reason each time reads as "my fix did nothing".
  it('reports an unchanged reason only once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const plugin = makePlugin()
    const controller = {
      enableUnifiedLogging: vi.fn(),
      getExtensionLoadRefusal: () => 'Variable $2$ used but not defined.',
      retryExtensionLoad: vi.fn(async () => ({
        status: 'refused' as const,
        reason: 'Variable $2$ used but not defined.'
      }))
    }

    await retryOn(plugin, controller)
    await retryOn(plugin, controller)

    // The launch-time print already showed this exact text.
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  // 'unknown' is not a verdict: stay quiet and leave the session as it was.
  it('says nothing when the browser could not be asked', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = {
      enableUnifiedLogging: vi.fn(),
      getExtensionLoadRefusal: () => 'some reason',
      retryExtensionLoad: vi.fn(async () => ({status: 'unknown' as const}))
    }

    await expect(retryOn(makePlugin(), controller)).resolves.toBe(false)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('tolerates a controller that cannot retry at all', async () => {
    const controller = {enableUnifiedLogging: vi.fn()}
    await expect(retryOn(makePlugin(), controller)).resolves.toBe(false)
  })

  it('never lets a throwing retry break the compile', async () => {
    const controller = {
      enableUnifiedLogging: vi.fn(),
      getExtensionLoadRefusal: () => 'some reason',
      retryExtensionLoad: vi.fn(async () => {
        throw new Error('CDP socket closed')
      })
    }

    await expect(retryOn(makePlugin(), controller)).resolves.toBe(false)
  })
})
