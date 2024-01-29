import resolver from './resolver'

// @ts-ignore
const context = '/' // window.__webpack_public_path__
console.log({context})

// - chrome.action.setIcon
// - chrome.browserAction.setIcon
// - chrome.pageAction.setIcon
// - chrome.sidePanel.setOptions
function resolvePath(objWithPath?: Record<string, any>) {
  console.log('handle path path:::::', {objWithPath})
  return {
    ...objWithPath,
    ...(objWithPath?.path && {path: resolver(context, objWithPath.path)})
  }
}

// - chrome.action.setPopup(objWithPopup)
// - chrome.browserAction.setPopup(objWithPopup)
// - chrome.pageAction.setPopup(objWithPopup)
// - chrome.scriptBadge.setPopup(objWithPopup)
function resolvePopup(objWithPopup?: Record<string, any>) {
  console.log('handle popup:::::', {objWithPopup})
  return {
    ...objWithPopup,
    ...(objWithPopup?.popup && {popup: resolver(context, objWithPopup.popup)})
  }
}

// - chrome.scripting.insertCSS(objWithFiles)
// - chrome.scripting.removeCSS(objWithFiles)
// - chrome.scripting.executeScript(objWithFiles)
// - chrome.scripting.registerContentScript(objWithFiles)
// - chrome.scripting.unregisterContentScript(objWithFiles)
function resolveFiles(objWithFiles?: Record<string, any>) {
  console.log('handle files path:::::', objWithFiles)
  return {
    ...objWithFiles,
    ...(objWithFiles?.files && {files: resolver(context, objWithFiles.files)})
  }
}

// - chrome.downloads.download(objWithUrl)
// - chrome.tabs.create(objWithUrl)
// - chrome.tabs.executeScript(objWithUrl)
// - chrome.tabs.insertCSS(objWithUrl)
function resolveUrl(objWithUrl?: Record<string, any>) {
  console.log('handle url path:::::', objWithUrl)
  return {
    ...objWithUrl,
    ...(objWithUrl?.url && {url: resolver(context, objWithUrl.url)})
  }
}

// - chrome.devtools.panels.create(..., stringPath, stringPath)
// - chrome.runtime.getURL(stringPath)
function resolveString(stringPath?: string) {
  console.log('handle string path:::::', stringPath)
  if (!stringPath) return
  return resolver(context, stringPath)
}

export default {
  resolvePath,
  resolvePopup,
  resolveFiles,
  resolveUrl,
  resolveString
}

export {resolvePath, resolvePopup, resolveFiles, resolveUrl, resolveString}
