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

  it('ignores a browser read on the branch a chrome check rules out', () => {
    for (const source of [
      'const storage = (typeof chrome !== "undefined" && chrome.storage) ? chrome.storage : browser.storage',
      'if (globalThis.chrome && chrome.runtime) { chrome.runtime.id } else { browser.runtime.id }',
      'const api = chrome.storage || browser.storage',
      'const api = globalThis.chrome?.runtime ?? browser.runtime'
    ]) {
      expect(referencesBrowserGlobal(source)).toBe(false)
    }
  })

  it('still finds a browser read that runs when chrome is present', () => {
    expect(
      referencesBrowserGlobal(
        'const api = chrome.storage && browser.storage.local'
      )
    ).toBe(true)

    expect(
      referencesBrowserGlobal(
        'const storage = chrome.storage ? browser.storage : null'
      )
    ).toBe(true)
  })

  it('ignores a guard written with the test first or through the global object', () => {
    expect(
      referencesBrowserGlobal(
        '"undefined"!=typeof browser&&console.log(browser.runtime.id)'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'if ("browser" in globalThis) { browser.runtime.id }'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'const guarded = typeof browser !== "undefined" ? browser.runtime.id : chrome.runtime.id'
      )
    ).toBe(false)
  })

  it('ignores a branch the define plugin folded away for this browser', () => {
    // What import.meta.env.EXTENSION_PUBLIC_BROWSER === "firefox" becomes in
    // a chrome build once the define plugin has run.
    expect(
      referencesBrowserGlobal(
        'if ("chrome" === "firefox") { browser.runtime.id }'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal('"chrome" === "firefox" && browser.runtime.id')
    ).toBe(false)

    expect(
      referencesBrowserGlobal('"chrome" !== "firefox" || browser.runtime.id')
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        '"chrome" !== "firefox" ? chrome.runtime.id : browser.runtime.id'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        '(() => { const isFirefoxLike = "chrome" === "firefox" || "chrome" === "gecko-based"; if (isFirefoxLike) { browser.runtime.id } })()'
      )
    ).toBe(false)

    expect(
      referencesBrowserGlobal(
        'const isFirefox = !("chrome" !== "firefox"); if (!isFirefox) {} else { browser.runtime.id }'
      )
    ).toBe(false)
  })

  it('still counts the branch a firefox build keeps, and an unfoldable test', () => {
    expect(
      referencesBrowserGlobal(
        'if ("firefox" === "firefox") { browser.runtime.id }'
      )
    ).toBe(true)

    expect(
      referencesBrowserGlobal('"firefox" === "firefox" && browser.runtime.id')
    ).toBe(true)

    expect(
      referencesBrowserGlobal(
        'if (location.host === "firefox") { browser.runtime.id }'
      )
    ).toBe(true)

    // A let can change, so its first value is no verdict.
    expect(
      referencesBrowserGlobal(
        'let isFirefox = "chrome" === "firefox"; if (isFirefox) { browser.runtime.id }'
      )
    ).toBe(true)
  })

  // A unicode escape of one of the letters turns the skipping off, so the
  // same script with such a string appended gives the unskipped answer.
  describe('skipping subtrees that never spell the name', () => {
    const unskipped = (source: string) =>
      referencesBrowserGlobal(`${source}\n;"\\u0062"`)

    const padding = Array.from(
      {length: 40},
      (_, index) =>
        `function pad${index}(a){var chrome=a;try{return a.browser?.x+pad${index}.name}catch(e){return {browser:1}}}`
    ).join('\n')

    const samples: Array<[string, boolean]> = [
      ['browser.runtime.id', true],
      ['const o = {browser: 1}; f(...browser)', true],
      ['({browser: 1}); const all = [...browser]', true],
      ['({browser: 1}); const o2 = {...browser}', true],
      ['const api = {browser}', true],
      ['x = a ? browser : b', true],
      ['switch (x) { case 1, browser: break }', true],
      ['(function(){ return function(){ return browser.tabs } })()', true],
      ['class A extends browser.B {}', true],
      ['label: for (;;) { browser.x; break label }', true],
      ['var o = {[browser]: 1}', true],
      ['`${browser.runtime.id}`', true],
      ['function f(){ if (x) { var browser = 1 } return browser }', false],
      ['function f(browser){ return browser.x }', false],
      ['function f({a: [browser = 1]}){ return browser.x }', false],
      ['(browser) => browser.x', false],
      ['try {} catch (browser) { browser.x }', false],
      ['for (const browser of list) browser.x', false],
      ['{ let browser = chrome; browser.x }', false],
      ['const f = function browser(){ return browser.name }', false],
      ['const C = class browser { m(){ return browser } }', false],
      ['import browser from "x"; browser.x', false],
      ['typeof browser !== "undefined" && browser.x', false],
      ['if ("browser" in globalThis) browser.x', false],
      ['const api = typeof chrome !== "undefined" ? chrome : browser', false],
      ['try { browser.x } catch { chrome.x }', false],
      ['const o = {browser: 1}; o.browser; o?.browser', false],
      ['if ("chrome" === "firefox") { browser.x }', false],
      [
        'const isFirefox = "chrome" === "firefox"; isFirefox && browser.x',
        false
      ],
      ['self.browser = self.chrome; browser.x', false],
      ['"browser"; /browser/.test(x); // browser\n/* browser */', false],
      ['function f(){ { function browser(){} } return 1 } browser.x', true],
      ['function f(){ var browser } f(); browser.x', true],
      ['const g = () => { const browser = 1; return browser }; browser.x', true]
    ]

    it('answers as the unskipped scan does on every shape', () => {
      for (const [source, expected] of samples) {
        expect(referencesBrowserGlobal(source), source).toBe(expected)
        expect(unskipped(source), source).toBe(expected)

        // Buried among functions that only name it as a property or a key.
        const buried = `${padding}\n(function(){${source.startsWith('import') ? '' : source}\n})()\n${padding}`

        expect(referencesBrowserGlobal(buried), buried.slice(-200)).toBe(
          unskipped(buried)
        )
      }
    })

    it('reads an identifier that spells a letter as an escape', () => {
      expect(
        referencesBrowserGlobal('const o = {browser: 1}; \\u0062rowser.tabs')
      ).toBe(true)

      expect(
        referencesBrowserGlobal(
          'const o = {browser: 1}; \\u{62}rowser.tabs.query({})'
        )
      ).toBe(true)
    })
  })
})
