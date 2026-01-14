import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest'
import {mountWithHMR} from '../scripts-lib/mount-runtime'

describe('mountWithHMR', () => {
  let originalWindow: any
  let originalDocument: any

  beforeEach(() => {
    originalWindow = globalThis.window
    originalDocument = (globalThis as any).document

    const listeners: Record<string, Function[]> = {}
    ;(globalThis as any).window = {
      addEventListener: (type: string, cb: any) => {
        listeners[type] = listeners[type] || []
        listeners[type].push(cb)
      },
      removeEventListener: (type: string, cb: any) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== cb)
      },
      dispatchEvent: (evt: any) => {
        for (const cb of listeners[evt?.type] || []) cb(evt)
      }
    }
    ;(globalThis as any).document = {
      readyState: 'complete',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
  })

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).document = originalDocument
  })

  it('calls mount and cleanup on dispose', () => {
    const cleanup = vi.fn()
    const mount = vi.fn(() => cleanup)
    const stop = mountWithHMR(mount)
    expect(mount).toHaveBeenCalled()
    stop()
    expect(cleanup).toHaveBeenCalled()
  })

  it('remounts on css update event', () => {
    const mount = vi.fn(() => undefined)
    mountWithHMR(mount)
    expect(mount).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new CustomEvent('__EXTENSIONJS_CSS_UPDATE__'))
    expect(mount).toHaveBeenCalledTimes(2)
  })
})

