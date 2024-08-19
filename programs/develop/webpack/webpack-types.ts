import {type LoaderContext as WebpackLoaderContext} from 'webpack'
import {type WebpackPluginInstance} from 'webpack'
import {DevOptions} from '../commands/dev'

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

export interface LoaderInterface extends WebpackLoaderContext<LoaderInterface> {
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
  plugins: WebpackPluginInstance[] | undefined
  loaders: Record<string, any>[] | undefined
  alias: Record<string, string> | undefined
}
