// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {omitDevOnlyEntries} from '../../plugin-special-folders/folders-config'
import type {DevOptions, FilepathList} from '../../types'
import {discoverWebAccessiblePages} from '../feature-web-resources/web-resources-lib/declared-pages'
import {discoverDevtoolsPanelPages} from './discover-devtools-panels'
import {discoverRuntimeSurfacePages} from './discover-runtime-surfaces'
import {settingsOverridesStartupPages} from './manifest-path-assets'
import {omitOwnedPages} from './omit-owned-pages'

export interface HtmlPageEntriesOptions {
  manifestPath: string
  browser: DevOptions['browser']
  projectPath?: string
  mode?: string
  manifestHtml?: FilepathList
  manifestScripts?: FilepathList
  specialFolderPages?: FilepathList
}

// Every HTML page the build compiles as a page entry, in one place: the
// manifest's own pages, the pages a script opens at runtime, devtools panels,
// web-accessible pages, startup pages and the pages/ folder. The HTML plugin
// emits this list and the JS plugin reads the same list to find each page's
// <script type="module">, so a module script on a page only a script names
// still compiles as a module.
export function htmlPageEntries(options: HtmlPageEntriesOptions): FilepathList {
  const {manifestPath, browser, projectPath} = options
  const manifestHtml = options.manifestHtml || {}
  const manifestScripts = options.manifestScripts || {}

  // A `*.dev.html` page a script names by literal is still development
  // only: production code that reads it is dead code behind a mode guard.
  const forThisMode = (pages: FilepathList): FilepathList =>
    options.mode === 'production' ? omitDevOnlyEntries(pages) : pages

  const ownedPages: FilepathList = {
    ...manifestHtml,
    // Pages reachable only through chrome.devtools.panels.create never
    // appear in the manifest; without this the panel 404s in the browser.
    ...discoverDevtoolsPanelPages(manifestPath, browser),
    ...settingsOverridesStartupPages(manifestPath, browser, projectPath)
  }

  return {
    ...forThisMode(
      discoverRuntimeSurfacePages(manifestPath, manifestScripts, manifestHtml)
    ),
    ...discoverWebAccessiblePages(manifestPath, browser, projectPath),
    ...ownedPages,
    ...omitOwnedPages(options.specialFolderPages, ownedPages)
  }
}
