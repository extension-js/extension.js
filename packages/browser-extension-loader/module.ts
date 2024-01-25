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
import {has} from './src/parsers'

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

        if (
          // 1 - chrome.action
          // 1.1 - chrome.action.setIcon: chrome.action.setIcon({path: 'icon.png'})
          has(callee, 'chrome.action.setIcon') ||
          // 1.2 - chrome.action.setPopup: chrome.action.setIcon({ path: { 48: 'icon48.png' } })
          has(callee, 'chrome.action.setPopup') ||
          // 2. chrome.browserAction
          // 2.1 - chrome.browserAction.setIcon: chrome.browserAction.setIcon({path: 'icon.png'})
          has(callee, 'chrome.browserAction.setIcon') ||
          // 2.2 - chrome.browserAction.setPopup: chrome.browserAction.setPopup({popup: 'popup.html'})
          has(callee, 'chrome.browserAction.setPopup') ||
          // 3 - chrome.devtools
          // 3.1 - chrome.devtools.panels.create('MyPanel', 'icon.png', 'panel.html', (panel) => {})
          has(callee, 'chrome.devtools.panels.create') ||
          // 4 - chrome.downloads
          // 4.1 - chrome.downloads.download({url: 'http://example.org/file.pdf'})
          has(callee, 'chrome.downloads.download') ||
          // 4.2 - chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => { suggest({filename: 'customfolder/customname.pdf'}); });
          has(callee, 'chrome.downloads.onDeterminingFilename.addListener') ||
          // 5 - chrome.pageAction
          // 5.1 - chrome.pageAction.setIcon: chrome.pageAction.setIcon({path: 'icon.png'})
          // 5.2 - chrome.pageAction.setPopup: chrome.pageAction.setPopup({popup: 'popup.html'})
          has(callee, 'chrome.pageAction.setIcon') ||
          has(callee, 'chrome.pageAction.setPopup') ||
          // 6 - chrome.runtime
          // # Returns full qualified urls like chrome-extension://<extension-id>/script.js
          // 6.1 - chrome.runtime.getURL('script.js')
          has(callee, 'chrome.runtime.getURL') ||
          // 7 - chrome.scripting
          // 7.1 - chrome.scripting.insertCSS({ files: ["styles.css"] });
          // 7.2 - chrome.scripting.removeCSS({ files: ['styles.css'] });
          // 7.3 - chrome.scripting.executeScript({ files: ['script.js'] });
          // 7.4 - chrome.scripting.registerContentScript({ files: ['script.js'] });
          // 7.5 - chrome.scripting.unregisterContentScript('script.js');
          has(callee, 'chrome.scripting.insertCSS') ||
          has(callee, 'chrome.scripting.removeCSS') ||
          has(callee, 'chrome.scripting.executeScript') ||
          has(
            callee,
            'chrome.scripting.registerContentScript'
          ) ||
          has(
            callee,
            'chrome.scripting.unregisterContentScript'
          ) ||
          // 8 - chrome.scriptBadge
          // 8.1 - chrome.scriptBadge.setPopup({ popup: "popup.html" });
          has(callee, 'chrome.scriptBadge.setPopup') ||
          // 9 - chrome.tabs
          // 9.1 - chrome.tabs.create({url: 'path/to/local/file.html'})
          // 9.2 - chrome.tabs.executeScript(tabId, {file: 'path/to/script.js'})
          // 9.3 - chrome.tabs.insertCSS(tabId, {file: 'path/to/style.css'})
          has(callee, 'chrome.tabs.create') ||
          has(callee, 'chrome.tabs.executeScript') ||
          has(callee, 'chrome.tabs.insertCSS') ||
          // 10 - chrome.sidePanel
          // 10.1 - chrome.sidePanel.setOptions({path: 'panel.html'}, () => {})
          has(callee, 'chrome.sidePanel.setOptions')
        ) {
          console.log('chrome.* API found', callee)
        }

        results.forEach((result) => {
          source = processResult(this as any, result, source)
        })
      }
    })
  }

  return source
}
