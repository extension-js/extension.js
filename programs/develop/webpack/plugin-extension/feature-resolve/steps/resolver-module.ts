const messages = {
  resolverNotFoundError() {
    console.error(
      `Could not resolve file path. Ensure the file exists in the "public" or "pages" directory.`
    )
  },

  resolverHtmlError: (filePath: string) => {
    console.error(
      `Could not resolve path ${filePath}. Either add it to the "public" directory or create a page in the "pages" directory.`
    )
    return filePath
  },

  resolverJsError: (filePath: string) => {
    return `Could not resolve path ${filePath}. Either add it to the "public" directory or create a script in the "scripts" directory.`
  },

  resolverStaticError: (filePath: string) => {
    return `Could not resolve path ${filePath}. If you want to preserve this file path, add the file to the "public" directory.`
  }
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

  if (filePath) {
    console.error(messages.resolverStaticError(filePath))
  }

  return filePath
}

// includeList is a map of the file path to the key
// This is used to resolve the file path to the key.
// emitResolverModule is responsible for generating this map,
// which is done at runtime.
const includeList = {data: '__RESOLVER_MODULE_FILE_LIST__'}

function resolver(filePath?: string): string {
  if (!filePath) {
    messages.resolverNotFoundError()
    return ''
  }

  if (
    filePath?.startsWith('http') ||
    filePath?.startsWith('chrome://') ||
    filePath?.startsWith('about:')
  ) {
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

      if (
        value === filepathNormalized ||
        value === `pages/${filepathNormalized}` ||
        value === `scripts/${filepathNormalized}`
      ) {
        return key
      }

      // TODO: cezaraugusto - this was not tested
      return false
    }
  )

  const pathNorlaized = pathNormalize(filePath)

  if (pathNorlaized.includes('public/')) {
    return '/' + pathNorlaized
  }

  if (resolvedValue && resolvedValue.length) {
    return resolvedValue[0]
  }

  // Avoid catching the parameter of chrome.runtime.getURL('/')
  // which is a valid call to get the extension URL.
  // See https://github.com/cezaraugusto/extension.js/issues/67
  if (filePath !== '/') {
    resolverError(filePath)
  }

  return filePath
}

type SolveType = Record<string, any> | Array<Record<string, any>> | string

function solve(apiArgument?: SolveType) {
  // - chrome.devtools.panels.create(..., stringPath, stringPath, ...)
  // - chrome.runtime.getURL(stringPath)
  if (typeof apiArgument === 'string') {
    return resolver(apiArgument)
  }

  const propertyResolver = (obj: {
    path?: string | Record<string, string>
    popup?: string
    url?: string
    iconUrl?: string
    files?: string[]
    js?: string | string[]
    css?: string | string[]
  }) => ({
    ...obj,
    // chrome.sidePanel.setOptions({..., path: string})
    // chrome.action.setIcon({..., path: string | Record<string, string>})
    // chrome.browserAction.setIcon({..., path: string | Record<string, string>})
    // chrome.pageAction.setIcon({..., path: string | Record<string, string>})
    // - https://developer.chrome.com/docs/extensions/reference/api/declarativeContent#type-SetIcon
    // chrome.declarativeContent.SetIcon({..., path: string | Record<string, string>})
    ...(obj?.path && {
      path:
        typeof obj.path === 'string'
          ? resolver(obj.path)
          : Object.entries(obj.path).reduce((acc, [key, value]) => {
              // Apply the resolver to each value in the path object
              ;(acc as Record<string, string>)[key] = resolver(value)
              return acc
            }, {})
    }),

    // chrome.action.setPopup({..., popup: string})
    // chrome.browserAction.setPopup({..., popup: string})
    // chrome.pageAction.setPopup({..., popup: string})
    // chrome.scriptBadge.setPopup({..., popup: string})
    ...(obj?.popup && {popup: resolver(obj.popup)}),

    // chrome.downloads.download({..., url: string})
    // chrome.tabs.create({..., url: string})
    // chrome.tabs.executeScript({..., url: string})
    // chrome.tabs.insertCSS({..., url: string})
    // chrome.windows.create({..., url: string || string[]})
    ...(obj?.url && {
      url: Array.isArray(obj?.url)
        ? obj?.url.map((currentUrl: string) => resolver(currentUrl))
        : resolver(obj?.url)
    }),

    // chrome.notifications.create
    // https://developer.chrome.com/docs/extensions/reference/api/notifications#property-NotificationOptions-iconUrl
    ...(obj?.iconUrl && {iconUrl: resolver(obj.iconUrl)}),

    // chrome.scripting.insertCSS(..., files: string[])
    // chrome.scripting.removeCSS(..., files: string[])
    // chrome.scripting.executeScript(..., files: string[])
    // chrome.scripting.registerContentScript(..., files: string[])
    // chrome.scripting.unregisterContentScript(..., files: string[])
    ...(obj?.files && {
      files: obj.files.map((file: string) => resolver(file))
    }),

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return apiArgument.map((arg) => propertyResolver(arg))
  }

  return {
    ...propertyResolver(apiArgument || {})
  }
}

const r = {solve}

export default r
