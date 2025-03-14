import {
  type RspackPluginInstance,
  type LoaderContext as RspackLoaderContext
} from '@rspack/core'
import {type DevOptions} from '../commands/commands-lib/config-types'

export type ChromeManifest = Partial<chrome.runtime.ManifestV2> &
  Partial<chrome.runtime.ManifestV3> & {
    browser_action?: {
      theme_icons?: ThemeIcon[]
    }
  }

export type Manifest = ChromeManifest

export interface ThemeIcon {
  light: string
  dark: string
  size?: number
}

export type PluginInterface = {
  manifestPath: string
  browser?: DevOptions['browser']
  includeList?: FilepathList
  excludeList?: FilepathList
}

export interface LoaderInterface extends RspackLoaderContext<LoaderInterface> {
  manifestPath: string
  includeList?: FilepathList
  excludeList?: FilepathList
}

export type FilepathList = Record<string, string | string[] | undefined>

export type ResourceType =
  | 'script'
  | 'css'
  | 'html'
  | 'static'
  | 'staticSrc'
  | 'staticHref'
  | 'empty'

export type HtmlFilepathList = Record<
  string,
  | {
      html: string
      js: string[]
      css: string[]
      static: string[]
    }
  | undefined
>

export interface LoaderContext {
  resourcePath: string
  emitFile: (name: string, content: string) => void
  getOptions: () => {
    test: string
    manifestPath: string
    browser?: DevOptions['browser']
    includeList?: FilepathList
    excludeList?: FilepathList
  }
}

export interface JsFramework {
  plugins: RspackPluginInstance[] | undefined
  loaders: Record<string, any>[] | undefined
  alias: Record<string, string> | undefined
}
