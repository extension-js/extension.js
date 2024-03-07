import {blue, underline} from '@colors/colors'
import bcd from '@mdn/browser-compat-data'

export function getManifestDocumentationURL(browser?: string) {
  const isChrome = browser === 'chrome'
  const chromeUrl =
    'https://developer.chrome.com/docs/extensions/reference/manifest'
  const mdnUrl = `https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json`

  return isChrome ? blue(underline(chromeUrl)) : blue(underline(mdnUrl || ''))
}

export function getApiDocumentationURL(browser: string, namespace: string) {
  const extensionKnowledge = bcd.webextensions.manifest
  const isChrome = browser === 'chrome'
  const chromeUrl = `https://developer.chrome.com/docs/extensions/reference/api/${namespace}`
  const mdnUrl = extensionKnowledge?.[namespace].__compat?.mdn_url

  return isChrome ? blue(underline(chromeUrl)) : blue(underline(mdnUrl || ''))
}
