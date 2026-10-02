import {describe, expect, it} from 'vitest'
import {referencesBrowserGlobal} from '../compatibility-lib/free-browser-references'

describe('referencesBrowserGlobal', () => {
  it('finds a bare browser.* call', () => {
    expect(
      referencesBrowserGlobal('browser.storage.local.get("k").then(() => {})')
    ).toBe(true)
  })

  it('finds the call inside a bundled module wrapper', () => {
    expect(
      referencesBrowserGlobal(
        '(()=>{"use strict";browser.runtime.onInstalled.addListener(()=>{})})();'
      )
    ).toBe(true)
  })

  it('finds a shorthand property read', () => {
    expect(referencesBrowserGlobal('const api = {browser}')).toBe(true)
  })

  it('ignores a property named browser', () => {
    expect(referencesBrowserGlobal('globalThis.browser.storage')).toBe(false)
    expect(referencesBrowserGlobal('window.browser?.runtime')).toBe(false)
    expect(referencesBrowserGlobal('const o = {browser: 1}; o.browser')).toBe(
      false
    )

    expect(referencesBrowserGlobal('class A { browser() {} }')).toBe(false)
  })

  it('ignores a local binding named browser', () => {
    expect(
      referencesBrowserGlobal('const browser = chrome; browser.tabs.query({})')
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'function f(browser) { return browser.tabs } f(chrome)'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'const {browser} = globalThis; browser.storage.local.get("k")'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'import browser from "webextension-polyfill"; browser.tabs.query({})'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        '(() => { var browser = chrome; function g() { browser.tabs } })()'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'try { chrome.tabs } catch (browser) { browser.message }'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal('for (const browser of []) browser.tabs')
    ).toBe(false)
  })

  it('ignores a read guarded by a typeof or in check', () => {
    expect(
      referencesBrowserGlobal(
        'const api = typeof browser !== "undefined" ? browser : chrome'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'if (typeof browser === "object") { browser.tabs.query({}) }'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'typeof browser === "undefined" || Object.getPrototypeOf(browser) !== Object.prototype'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'const api = "browser" in self ? browser : chrome'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'const api = globalThis.browser ? browser : chrome'
      )
    ).toBe(false)
  })

  it('still finds a read a sibling binding does not cover', () => {
    expect(
      referencesBrowserGlobal(
        'function f() { const browser = chrome } browser.tabs.query({})'
      )
    ).toBe(true)

    expect(
      referencesBrowserGlobal(
        '{ let browser = chrome } browser.storage.local.get("k")'
      )
    ).toBe(true)
  })

  it('stays quiet on text that never spells the name as code', () => {
    expect(referencesBrowserGlobal('chrome.storage.local.get("browser")')).toBe(
      false
    )

    expect(referencesBrowserGlobal('const n = ""')).toBe(false)
  })

  it('ignores a script that defines the global itself', () => {
    expect(
      referencesBrowserGlobal(
        'window.browser = window.browser || window.chrome; browser.runtime.sendMessage("x")'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'globalThis.browser ??= chrome; browser.runtime.sendMessage("x")'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        '(()=>{self.browser=self.browser||self.chrome})();(()=>{browser.tabs.query({})})();'
      )
    ).toBe(false)
  })

  it('ignores a read whose catch falls back to chrome', () => {
    expect(
      referencesBrowserGlobal(
        'let api; try { api = browser } catch (e) { api = chrome } api.runtime.sendMessage("x")'
      )
    ).toBe(false)
  })

  it('still finds a read whose catch only logs', () => {
    expect(
      referencesBrowserGlobal(
        'try { browser.runtime.sendMessage("x") } catch (e) { console.error(e) }'
      )
    ).toBe(true)
  })
})
