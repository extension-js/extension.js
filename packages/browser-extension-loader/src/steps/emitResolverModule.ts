import path from 'path'
import fs from 'fs'
import {BrowserExtensionContext} from '../../module'

export interface ParseResult {
  path: string
}

const data = `/* lalala */
;const MAGICAL_MYSTIC_STRING = 'magical-mystic-string'

// The handlePathroperty will add an import to this function.
// - chrome.action.setIcon
// - chrome.browserAction.setIcon
// - chrome.pageAction.setIcon
// - chrome.sidePanel.setOptions
function handlePath(objWithPaathProperty) {
// console.log({objWithPaathProperty})
// // Custom logic for objects with 'path'
// return obj
}

// The handlePopupProperty will add an import to this function.
// - chrome.action.setPopup(objWithPopupProperty)
// - chrome.browserAction.setPopup(objWithPopupProperty)
// - chrome.pageAction.setPopup(objWithPopupProperty)
// - chrome.scriptBadge.setPopup(objWithPopupProperty)
function handlePopup(objWithPopupProperty) {
// console.log({objWithPopupProperty})
// // Custom logic for objects with 'popup'
// return (objWithPopupProperty)
}

// The handeFilesProperty will add an import to this function.
// Methods involved:
// - chrome.scripting.insertCSS(objWithFilesProperty)
// - chrome.scripting.removeCSS(objWithFilesProperty)
// - chrome.scripting.executeScript(objWithFilesProperty)
// - chrome.scripting.registerContentScript(objWithFilesProperty)
// - chrome.scripting.unregisterContentScript(objWithFilesProperty)
function handeFiles(objWithFilesProperty) {
// console.log({objWithFilesProperty})
// // Custom logic for objects with 'files'
// return objWithFilesProperty
}

// The handleUrlProperty will add an import to this function.
// Methods involded:
// - chrome.downloads.download(objWithUrlProperty)
// - chrome.tabs.create(objWithUrlProperty)
// - chrome.tabs.executeScript(objWithUrlProperty)
// - chrome.tabs.insertCSS(objWithUrlProperty)
function handleUrl(objWithUrlProperty) {
// console.log({objWithUrlProperty: objWithUrlProperty})

// return {
//   ...objWithUrlProperty,
//   url: MAGICAL_MYSTIC_STRING
// }
}

// The handleStringProperty will add an import to this function.
// Methods involded:
// - chrome.devtools.panels.create(..., stringPath, stringPath)
// - chrome.runtime.getURL(stringPath)
function handleString(stringPath) {
// console.log({stringFound: stringPath})
// // Custom logic for string paths
// return MAGICAL_MYSTIC_STRING
};

export default {
handlePath,
handlePopup,
handeFiles,
handleUrl,
handleString
};
`

export default function emitResolverModule(
  self: BrowserExtensionContext,
  resolverName: string
) {
  const outputPath = self?._compilation?.options.output.path || ''
  const resolverAbsolutePath = path.resolve(outputPath, resolverName)

  if (!fs.existsSync(resolverAbsolutePath)) {
    self.emitFile(resolverName, data)
  }
}
