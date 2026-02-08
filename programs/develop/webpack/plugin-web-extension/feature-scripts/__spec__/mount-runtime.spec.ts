import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest'
import {mountWithHMR} from '../scripts-lib/mount-runtime'

describe('mountWithHMR', () => {
  let originalWindow: any
  let originalDocument: any
  let docListeners: Record<string, Function[]>

  beforeEach(() => {
    originalWindow = globalThis.window
    originalDocument = (globalThis as any).document

    const listeners: Record<string, Function[]> = {}
    docListeners = {}
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
      addEventListener: (type: string, cb: any) => {
        docListeners[type] = docListeners[type] || []
        docListeners[type].push(cb)
      },
      removeEventListener: (type: string, cb: any) => {
        docListeners[type] = (docListeners[type] || []).filter((f) => f !== cb)
      }
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

  it('respects runAt=document_end by waiting for interactive/complete', () => {
    ;(globalThis as any).document.readyState = 'loading'
    const mount = vi.fn(() => undefined)
    mountWithHMR(mount, 'document_end')
    expect(mount).toHaveBeenCalledTimes(0)
    ;(globalThis as any).document.readyState = 'interactive'
    for (const cb of docListeners['readystatechange'] || []) cb()
    expect(mount).toHaveBeenCalledTimes(1)
  })
})
