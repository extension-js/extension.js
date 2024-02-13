import messages from './helpers/messages'

function notFoundError() {
  console.error(messages.notFoundError)
  return ''
}

function pathNormalize(path: string) {
  if (path.startsWith('/')) {
    path = path.substring(1)
  }

  if (path.startsWith('./')) {
    path = path.substring(2)
  }

  return path
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

// includeList is a map of the file path to the key
// This is used to resolve the file path to the key.
// emitResolverModule is responsible for generating this map,
// which is done at runtime.
const includeList = {data: '__RESOLVER_MODULE_FILE_LIST__'}

function resolver(filePath?: string): string {
  console.log('dark', filePath)
  if (!filePath) {
    return notFoundError()
  }

  if (filePath?.startsWith('http')) {
    return filePath
  }

  if (filePath?.startsWith('chrome-extension://')) {
    const extensionUrl = chrome.runtime.getURL('')

    console.log({
      extensionUrl,
      filePath: filePath.replace(extensionUrl, '')
    })

    if (filePath.startsWith(extensionUrl)) {
      const urlPath = filePath.replace(extensionUrl, '')

      return resolver(urlPath)
    }

    return filePath
  }

  // Special case for favicon
  if (filePath?.startsWith('/_favicon')) return filePath

  const resolvedValue = Object.entries(includeList.data).find(
    ([key, value]) => {
      const filepathNormalized = pathNormalize(filePath)
      console.log('123123adasdasdas222222222', {
        value,
        filepathNormalized,
        key
      })
      if (value === filepathNormalized) {
        return key
      }
    }
  )

  console.log('public path exists::::::', resolvedValue)
  if (resolvedValue) {
    return resolvedValue[0]
  }

  resolverError(filePath)
  return filePath
}

type SolveType = Record<string, any> | Record<string, any>[] | string

function solve(apiArgument?: SolveType) {
  // - chrome.devtools.panels.create(..., stringPath, stringPath)
  // - chrome.runtime.getURL(stringPath)
  if (typeof apiArgument === 'string') {
    return resolver(apiArgument)
  }

  const resolveProperty = (obj: Record<string, any>) => ({
    ...obj,
    // - chrome.action.setIcon
    // - chrome.browserAction.setIcon
    // - chrome.pageAction.setIcon
    // - chrome.sidePanel.setOptions
    ...(obj?.path && {path: resolver(obj.path)}),
    // - chrome.action.setPopup(objWithPopup)
    // - chrome.browserAction.setPopup(objWithPopup)
    // - chrome.pageAction.setPopup(objWithPopup)
    // - chrome.scriptBadge.setPopup(objWithPopup)
    ...(obj?.popup && {popup: resolver(obj.popup)}),
    // - chrome.downloads.download(objWithUrl)
    // - chrome.tabs.create(objWithUrl)
    // - chrome.tabs.executeScript(objWithUrl)
    // - chrome.tabs.insertCSS(objWithUrl)
    // - chrome.windows.create(objWithUrl)
    ...(obj?.url && {url: resolver(obj.url)}),
    // chrome.notifications.create
    ...(obj?.iconUrl && {iconUrl: resolver(obj.iconUrl)}),
    // - chrome.scripting.insertCSS(objWithFiles)
    // - chrome.scripting.removeCSS(objWithFiles)
    // - chrome.scripting.executeScript(objWithFiles)
    // - chrome.scripting.registerContentScript(objWithFiles)
    // - chrome.scripting.unregisterContentScript(objWithFiles)
    ...(obj?.files && obj?.files.map((file: string) => resolver(file))),
    // chrome.scripting.registerContentScripts
    // chrome.declarativeContent.RequestContentScripts
    ...(obj?.js && {
      css: Array.isArray(obj?.js)
        ? obj?.js.map((file: string) => resolver(file))
        : obj?.js
    }),
    // chrome.declarativeContent.RequestContentScripts
    ...(obj?.css && {
      css: Array.isArray(obj?.css)
        ? obj?.css.map((file: string) => resolver(file))
        : obj?.css
    })
  })

  if (Array.isArray(apiArgument)) {
    return apiArgument.map(resolveProperty(apiArgument))
  }

  return {
    ...resolveProperty(apiArgument || {})
  }
}

// - chrome.action.setIcon
// - chrome.browserAction.setIcon
// - chrome.pageAction.setIcon
// - chrome.sidePanel.setOptions
function resolvePath(objWithPath?: Record<string, any>) {
  console.log('handle path path  ►►►', {objWithPath})
  if (!objWithPath?.path) {
    return objWithPath
  }
  console.log('handle path path (resolved) ►►►', {
    objWithPath: resolver(objWithPath?.path)
  })
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
  if (!objWithPopup?.popup) {
    return objWithPopup
  }

  console.log('handle popup (resolved) ►►►', {
    objWithPopup: resolver(objWithPopup?.popup)
  })
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
  if (!objWithFiles?.files) {
    return objWithFiles
  }

  const resolvedFiles = objWithFiles?.files.map((file: string) =>
    resolver(file)
  )

  console.log('handle files path (resolved)  ►►►', resolvedFiles)
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
  if (!objWithUrl?.url) {
    return objWithUrl
  }

  console.log('handle url path (resolved)  ►►►', resolver(objWithUrl?.url))
  return {
    ...objWithUrl,
    ...(objWithUrl?.url && {url: resolver(objWithUrl.url)})
  }
}

// - chrome.devtools.panels.create(..., stringPath, stringPath)
// - chrome.runtime.getURL(stringPath)
function resolveString(stringPath?: string) {
  console.log('handle string path  ►►►', stringPath)
  console.log('handle string path (resolved) ►►►', resolver(stringPath))

  return resolver(stringPath)
}

// chrome.notifications.create
function resolveIconUrl(objWithIconUrl?: Record<string, any>) {
  if (!objWithIconUrl?.iconUrl) {
    return objWithIconUrl
  }

  console.log('handle iconUrl path  ►►►', objWithIconUrl)
  console.log(
    'handle iconUrl path (resolved) ►►►',
    resolver(objWithIconUrl?.iconUrl)
  )
  return {
    ...objWithIconUrl,
    ...(objWithIconUrl?.iconUrl && {iconUrl: resolver(objWithIconUrl.iconUrl)})
  }
}

// chrome.scripting.registerContentScripts
// chrome.declarativeContent.RequestContentScripts
function resolveJs(objWithFiles?: Record<string, any> | Record<string, any>[]) {
  if (Array.isArray(objWithFiles)) {
    return objWithFiles.map((obj: Record<string, any>) => {
      console.log('handle js path  ►►►', obj)
      if (obj?.js.length === 0) {
        return obj
      }

      const resolvedFiles = obj.js.map((file: string) => resolver(file))
      return {
        ...obj,
        ...(obj.js && {js: resolvedFiles})
      }
    })
  }

  console.log('handle js path  ►►►', objWithFiles)
  if (objWithFiles?.js.length === 0) {
    return objWithFiles
  }

  const resolvedFiles = objWithFiles?.js.map((file: string) => resolver(file))

  return {
    ...objWithFiles,
    ...(objWithFiles?.js && {js: resolvedFiles})
  }
}

// chrome.declarativeContent.RequestContentScripts
function resolveCss(objWithFiles?: Record<string, any>) {
  if (Array.isArray(objWithFiles)) {
    return objWithFiles.map((obj: Record<string, any>) => {
      console.log('handle css path  ►►►', obj)
      if (obj?.css.length === 0) {
        return obj
      }

      const resolvedFiles = obj.css.map((file: string) => resolver(file))
      return {
        ...obj,
        ...(obj.css && {css: resolvedFiles})
      }
    })
  }

  console.log('handle css path  ►►►', objWithFiles)
  if (objWithFiles?.css.length === 0) {
    return objWithFiles
  }

  const resolvedFiles = objWithFiles?.css.map((file: string) => resolver(file))

  return {
    ...objWithFiles,
    ...(objWithFiles?.css && {css: resolvedFiles})
  }
}

export default {
  solve,
  resolvePath,
  resolvePopup,
  resolveFiles,
  resolveUrl,
  resolveString,
  resolveIconUrl,
  resolveJs,
  resolveCss
}
