import messages from './helpers/messages'
function notFoundError() {
  console.error(messages.notFoundError)
  return ''
}

function pathResolve(path: string) {
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
  if (!filePath) {
    return notFoundError()
  }
  // If URL, return as is
  if (filePath?.startsWith('http')) return filePath

  // Special case for favicon
  if (filePath?.startsWith('/_favicon')) return filePath

  // Iterate over the includesList to find the key by its value
  for (const [key, value] of Object.entries(includeList.data)) {
    const filePathResolved = pathResolve(value)
    console.error({
      key,
      value,
      filePath,
      filePathResolved,
      iseq: value === filePathResolved
    })
    if (value === filePathResolved) {
      return key
    }
  }

  resolverError(filePath)
  return filePath
}

type ResolveApiType = Record<string, any> | Record<string, any>[] | string

function resolveApi(apiArgument?: ResolveApiType) {
  console.log('handle apiArgument  ►►►', {apiArgument})

  if (typeof apiArgument === 'string') {
    return resolver(apiArgument)
  }

  if (Array.isArray(apiArgument)) {
    return apiArgument.map((obj: Record<string, any>) => ({
      ...obj,
      ...(obj?.path && {path: resolver(obj.path)}),
      ...(obj?.popup && {popup: resolver(obj.popup)}),
      ...(obj?.url && {url: resolver(obj.url)}),
      ...(obj?.iconUrl && {iconUrl: resolver(obj.iconUrl)}),
      ...(obj?.files && obj?.files.map((file: string) => resolver(file))),
      ...(obj?.js && {js: obj?.js.map((file: string) => resolver(file))}),
      ...(obj?.css && {css: obj?.css.map((file: string) => resolver(file))})
    }))
  }

  return {
    ...apiArgument,
    ...(apiArgument?.path && {path: resolver(apiArgument.path)}),
    ...(apiArgument?.popup && {popup: resolver(apiArgument.popup)}),
    ...(apiArgument?.url && {url: resolver(apiArgument.url)}),
    ...(apiArgument?.iconUrl && {iconUrl: resolver(apiArgument.iconUrl)}),
    ...(apiArgument?.files &&
      apiArgument?.files.map((file: string) => resolver(file))),
    ...(apiArgument?.js && {
      js: apiArgument?.js.map((file: string) => resolver(file))
    }),
    ...(apiArgument?.css && {
      css: apiArgument?.css.map((file: string) => resolver(file))
    })
  }
}

// - chrome.action.setIcon
// - chrome.browserAction.setIcon
// - chrome.pageAction.setIcon
// - chrome.sidePanel.setOptions
function resolvePath(objWithPath?: Record<string, any>) {
  console.log('handle path path  ►►►', {objWithPath})
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
      const resolvedFiles = obj.js.map((file: string) => resolver(file))
      return {
        ...obj,
        ...(obj.js && {js: resolvedFiles})
      }
    })
  }

  console.log('handle js path  ►►►', objWithFiles)
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
      const resolvedFiles = obj.css.map((file: string) => resolver(file))
      return {
        ...obj,
        ...(obj.css && {css: resolvedFiles})
      }
    })
  }

  console.log('handle css path  ►►►', objWithFiles)
  const resolvedFiles = objWithFiles?.css.map((file: string) => resolver(file))

  return {
    ...objWithFiles,
    ...(objWithFiles?.css && {css: resolvedFiles})
  }
}

export default {
  resolvePath,
  resolvePopup,
  resolveFiles,
  resolveUrl,
  resolveString,
  resolveIconUrl,
  resolveJs,
  resolveCss
}
