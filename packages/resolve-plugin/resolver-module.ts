import messages from './helpers/messages'

function notFoundError() {
  console.error(messages.notFoundError)
  return ''
}

function pathNormalize(path: string): string {
  const parts = path.split('/')
  const stack: string[] = []

  for (const part of parts) {
    if (part === '..' || part === '.') {
      // Ignore '..' and '.' segments
      continue
    } else if (part !== '') {
      stack.push(part)
    }
  }

  return stack.join('/')
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

  if (filePath?.startsWith('http') || filePath?.startsWith('chrome://')) {
    return filePath
  }

  if (filePath?.startsWith('chrome-extension://')) {
    const extensionUrl = chrome.runtime.getURL('')

    if (filePath.startsWith(extensionUrl)) {
      const urlPath = filePath.replace(extensionUrl, '')

      return chrome.runtime.getURL(resolver(urlPath))
    }

    return filePath
  }

  // Special case for favicon
  if (filePath?.startsWith('/_favicon')) return filePath

  const resolvedValue = Object.entries(includeList.data).find(
    ([key, value]) => {
      const filepathNormalized = pathNormalize(filePath)

      if (value === filepathNormalized) {
        return key
      }
    }
  )

  if (resolvedValue && resolvedValue.length) {
    return resolvedValue[0]
  }

  resolverError(filePath)
  return filePath
}

type SolveType = Record<string, any> | Record<string, any>[] | string

function solve(apiArgument?: SolveType) {
  // - chrome.devtools.panels.create(..., stringPath, stringPath, ...)
  // - chrome.runtime.getURL(stringPath)
  if (typeof apiArgument === 'string') {
    return resolver(apiArgument)
  }

  const resolveProperty = (obj: Record<string, any>) => ({
    ...obj,
    // chrome.action.setIcon({..., path: string})
    // chrome.browserAction.setIcon({..., path: string})
    // chrome.pageAction.setIcon({..., path: string})
    // chrome.sidePanel.setOptions({..., path: string})
    // chrome.declarativeContent.SetIcon({..., path: string})
    // - https://developer.chrome.com/docs/extensions/reference/api/declarativeContent#type-SetIcon
    ...(obj?.path && {path: resolver(obj.path)}),

    // chrome.action.setPopup({..., popup: string})
    // chrome.browserAction.setPopup({..., popup: string})
    // chrome.pageAction.setPopup({..., popup: string})
    // chrome.scriptBadge.setPopup({..., popup: string})
    ...(obj?.popup && {popup: resolver(obj.popup)}),

    // chrome.downloads.download({..., url: string})
    // chrome.tabs.create({..., url: string})
    // chrome.tabs.executeScript({..., url: string})
    // chrome.tabs.insertCSS({..., url: string})
    // chrome.windows.create({..., url: string})
    ...(obj?.url && {url: resolver(obj.url)}),

    // chrome.notifications.create
    // https://developer.chrome.com/docs/extensions/reference/api/notifications#property-NotificationOptions-iconUrl
    ...(obj?.iconUrl && {iconUrl: resolver(obj.iconUrl)}),

    // chrome.scripting.insertCSS(..., files: string[])
    // chrome.scripting.removeCSS(..., files: string[])
    // chrome.scripting.executeScript(..., files: string[])
    // chrome.scripting.registerContentScript(..., files: string[])
    // chrome.scripting.unregisterContentScript(..., files: string[])
    ...(obj?.files && {files: obj.files.map((file: string) => resolver(file))}),

    // chrome.declarativeContent.RequestContentScript (css array)
    // - https://developer.chrome.com/docs/extensions/reference/api/declarativeContent#property-RequestContentScript-js
    // chrome.scripting.registerContentScripts (css array)
    // https://developer.chrome.com/docs/extensions/reference/api/scripting#property-RegisteredContentScript-js
    ...(obj?.js && {
      js: Array.isArray(obj.js)
        ? obj.js.map((file: string) => resolver(file))
        : obj.js
    }),

    // chrome.declarativeContent.RequestContentScript (css array)
    // - https://developer.chrome.com/docs/extensions/reference/api/declarativeContent#property-RequestContentScript-css
    // chrome.scripting.registerContentScripts (css array)
    // https://developer.chrome.com/docs/extensions/reference/api/scripting#property-RegisteredContentScript-css
    ...(obj?.css && {
      css: Array.isArray(obj.css)
        ? obj.css.map((file: string) => resolver(file))
        : obj.css
    })
  })

  if (Array.isArray(apiArgument)) {
    return apiArgument.map(resolveProperty(apiArgument))
  }

  return {
    ...resolveProperty(apiArgument || {})
  }
}

export default {
  solve
}
