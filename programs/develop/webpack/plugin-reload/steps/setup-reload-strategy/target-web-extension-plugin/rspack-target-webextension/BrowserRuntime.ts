// @ts-check
const basic = [
  `var isBrowser = !!(() => { try { return browser.runtime.getURL("/") } catch(e) {} })()`,
  `var isChrome = !!(() => { try { return chrome.runtime.getURL("/") } catch(e) {} })()`
]
const strong = [
  ...basic,
  `var runtime = isBrowser ? browser : isChrome ? chrome : { get runtime() { throw new Error("No chrome or browser runtime found") } }`
]
const weak = [
  ...basic,
  `var runtime = isBrowser ? browser : isChrome ? chrome : (typeof self === 'object' && self.addEventListener) ? { get runtime() { throw new Error("No chrome or browser runtime found") } } : { runtime: { getURL: x => x } }`
]

export default (getWeak = false) => (getWeak ? weak : strong)
