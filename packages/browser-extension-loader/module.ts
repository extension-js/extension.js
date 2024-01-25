import path from 'path'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import * as parser from '@babel/parser'
import traverse from '@babel/traverse'

import resolvePath from './src/resolver'
import {
  errorMessage,
  isManifestAsset,
  isPagesPath,
  isPublicPath,
  isUrl
} from './src/utils'
import {isBrowser, isListener, isMethod, isNamespace} from './src/parsers'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    }
  }
}

interface BrowserExtensionContext extends LoaderContext<any> {
  getOptions: () => {
    test: string
    options: {
      manifestPath: string
      include: string
      exclude: string
    }
  }
}

function processResult(
  self: BrowserExtensionContext,
  result: {path: string},
  source: string
) {
  if (isUrl(result.path)) return source

  const resultResolvedPath = resolvePath(self.rootContext, result.path)
  const resultAbsolutePath = path.resolve(self.rootContext, result.path)

  // if (!fs.existsSync(resultAbsolutePath)) {
  //   self.emitError(errorMessage(resultAbsolutePath, result, self.resourcePath))
  //   return source
  // }

  const isPublic = isPublicPath(self.rootContext, result.path)
  const isPages = isPagesPath(self.rootContext, result.path)

  if (
    !isManifestAsset(self.rootContext, resultAbsolutePath) &&
    !isPublic &&
    !isPages
  ) {
    self.emitFile(result.path, source)
  }

  return source.replace(
    new RegExp(result.path, 'g'),
    // result.path
    result.path + ` /* browser-extension-loader ${resultResolvedPath} */ `
  )
}

interface ParseResult {
  path: string
}

export default function (this: BrowserExtensionContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    const results: ParseResult[] = []

    traverse(ast as any, {
      CallExpression(path: any) {
        const callee = path.node.callee
        const args = path.node.arguments

        if (isBrowser(callee)) {
          if (!args.length) return

          // chrome.action (2 methods)
          // - chrome.action.setIcon: chrome.action.setIcon({path: 'icon.png'})
          // - chrome.action.setPopup: chrome.action.setIcon({ path: { 48: 'icon48.png' } })
          if (isNamespace(callee, 'action')) {
            if (isMethod(callee, 'action', 'setIcon')) {
            }
            if (isMethod(callee, 'action', 'setPopup')) {
            }
          }

          // chrome.browserAction (2 methods)
          // - chrome.browserAction.setIcon: chrome.browserAction.setIcon({path: 'icon.png'})
          // - chrome.browserAction.setPopup: chrome.browserAction.setPopup({popup: 'popup.html'})
          if (isNamespace(callee, 'browserAction')) {
            if (isMethod(callee, 'browserAction', 'setIcon')) {
            }
            if (isMethod(callee, 'browserAction', 'setPopup')) {
            }
          }

          // chrome.devtools
          // - chrome.devtools.panels
          if (isNamespace(callee, 'devtools')) {
            if (isMethod(callee, 'devtools', 'panels')) {
              // chrome.devtools.panels
            }

            // chrome.devtools.inspectedWindow
            // chrome.devtools.network
            // chrome.devtools.panels
          }

          // chrome.downloads
          if (isNamespace(callee, 'downloads')) {
            if (isMethod(callee, 'downloads', 'download')) {
              // chrome.downloads.download({url: 'http://example.org/file.pdf'})
            }

            if (
              isListener(
                callee,
                'downloads',
                'onDeterminingFilename',
                'addListener'
              )
            ) {
              // chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
              // suggest({filename: 'customfolder/customname.pdf'});
              // });
            }
          }

          // chrome.pageAction
          // - chrome.pageAction.setIcon
          // - chrome.pageAction.setPopup
          if (isNamespace(callee, 'pageAction')) {
            if (isMethod(callee, 'pageAction', 'setIcon')) {
              // chrome.pageAction.setIcon({path: 'icon.png'})
            }

            if (isMethod(callee, 'pageAction', 'setPopup')) {
              // chrome.pageAction.setPopup({popup: 'popup.html'})
            }
          }

          // chrome.runtime
          if (isNamespace(callee, 'runtime')) {
            if (isMethod(callee, 'runtime', 'getURL')) {
              // Returns full qualified urls like chrome-extension://<extension-id>/script.js
              // chrome.runtime.getURL('script.js')
            }
          }

          // chrome.scripting
          // - chrome.scripting.insertCSS({ files: ["styles.css"] });
          // - chrome.scripting.removeCSS({ files: ['styles.css'] });
          // - chrome.scripting.executeScript({ files: ['script.js'] });
          // - chrome.scripting.registerContentScript({ files: ['script.js'] });
          // - chrome.scripting.unregisterContentScript('script.js');

          // chrome.scriptBadge
          // - chrome.scriptBadge.setPopup({ popup: "popup.html" });
          if (isNamespace(callee, 'scriptBadge')) {
            if (isMethod(callee, 'scriptBadge', 'setPopup')) {
            }
          }

          // chrome.sessions

          // chrome.storage

          // chrome.socket

          // chrome.system

          // chrome.tabCapture

          // chrome.tabs

          // chrome.tabGroups

          // chrome.topSites

          // chrome.tts

          // chrome.ttsEngine

          // chrome.types

          // chrome.vpnProvider

          // chrome.wallpaper

          // chrome.webNavigation

          // chrome.webRequest

          // chrome.webstore

          // chrome.windows

          // chrome.declarativeNetRequest

          // chrome.sidePanel
        }

        results.forEach((result) => {
          source = processResult(this as any, result, source)
        })
      }
    })
  }

  return source
}
