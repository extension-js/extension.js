import messages from './helpers/messages'
function notFoundError() {
  console.error(messages.notFoundError)
  return ''
}

function resolverError(filePath?: string) {
  if (filePath?.endsWith('.html')) {
    console.error(messages.resolverHtmlError(filePath))
    return filePath
  }
  if (filePath?.endsWith('.js')) {
    console.error(messages.resolverJsError(filePath))
    return filePath
  }

  console.error(messages.resolverStaticError(filePath))
  return filePath
}

const includeList = {
  'pages/page.html': 'pages/index.html',
  'scripts/content-script.js': 'scripts/content-script.js',
  'background/script.js': undefined,
  'background/service_worker.js': 'sw.js',
  'content_scripts/script-0.js': undefined,
  'user_scripts/apiscript.js': undefined,
  'action/index.html': undefined,
  'background/index.html': undefined,
  'browser_action/index.html': undefined,
  'chrome_settings_overrides/index.html': undefined,
  'chrome_url_overrides/index.html': undefined,
  'devtools_page/index.html': undefined,
  'options_ui/index.html': undefined,
  'page_action/index.html': undefined,
  'sandbox/page-0.html': undefined,
  'side_panel/index.html': undefined,
  'sidebar_action/index.html': undefined
}

function resolver(filePath?: string): string {
  if (!filePath) {
    return notFoundError()
  }
  // If URL, return as is
  if (filePath?.startsWith('http')) return filePath

  // Iterate over the includesList to find the key by its value
  for (const [key, value] of Object.entries(includeList)) {
    if (value === filePath) {
      return key
    }
  }

  resolverError(filePath)
  return filePath
}

// - chrome.action.setIcon
// - chrome.browserAction.setIcon
// - chrome.pageAction.setIcon
// - chrome.sidePanel.setOptions
function resolvePath(objWithPath?: Record<string, any>) {
  console.log('handle path path  ►►►', {objWithPath})
  return {
    ...objWithPath,
    ...(objWithPath?.path && {path: resolver(objWithPath.path)})
  }
}

// - chrome.action.setPopup(objWithPopup)
// - chrome.browserAction.setPopup(objWithPopup)
// - chrome.pageAction.setPopup(objWithPopup)
// - chrome.scriptBadge.setPopup(objWithPopup)
function resolvePopup(objWithPopup?: Record<string, any>) {
  console.log('handle popup  ►►►', {objWithPopup})
  return {
    ...objWithPopup,
    ...(objWithPopup?.popup && {popup: resolver(objWithPopup.popup)})
  }
}

// - chrome.scripting.insertCSS(objWithFiles)
// - chrome.scripting.removeCSS(objWithFiles)
// - chrome.scripting.executeScript(objWithFiles)
// - chrome.scripting.registerContentScript(objWithFiles)
// - chrome.scripting.unregisterContentScript(objWithFiles)
function resolveFiles(objWithFiles?: Record<string, any>) {
  console.log('handle files path  ►►►', objWithFiles)
  const resolvedFiles = objWithFiles?.files.map((file: string) =>
    resolver(file)
  )
  return {
    ...objWithFiles,
    ...(objWithFiles?.files && {files: resolvedFiles})
  }
}

// - chrome.downloads.download(objWithUrl)
// - chrome.tabs.create(objWithUrl)
// - chrome.tabs.executeScript(objWithUrl)
// - chrome.tabs.insertCSS(objWithUrl)
// - chrome.windows.create(objWithUrl)
function resolveUrl(objWithUrl?: Record<string, any>) {
  console.log('handle url path  ►►►', objWithUrl)
  return {
    ...objWithUrl,
    ...(objWithUrl?.url && {url: resolver(objWithUrl.url)})
  }
}

// - chrome.devtools.panels.create(..., stringPath, stringPath)
// - chrome.runtime.getURL(stringPath)
function resolveString(stringPath?: string) {
  console.log('handle string path  ►►►', stringPath)
  if (stringPath?.startsWith('/_favicon')) return stringPath

  return resolver(stringPath)
}

function resolveIconUrl(objWithIconUrl?: Record<string, any>) {
  console.log('handle iconUrl path  ►►►', objWithIconUrl)
  return {
    ...objWithIconUrl,
    ...(objWithIconUrl?.iconUrl && {iconUrl: resolver(objWithIconUrl.iconUrl)})
  }
}

export default {
  resolvePath,
  resolvePopup,
  resolveFiles,
  resolveUrl,
  resolveString,
  resolveIconUrl
}
