// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {
  LoaderContext as RspackLoaderContext,
  RspackPluginInstance
} from '@rspack/core'

/**
 * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme_experiment
 */
export interface ThemeExperiment {
  stylesheet?: string
  stylesheets?: string[]
  // Firefox also allows colors/images/properties maps; kept open for forward-compat.
  [key: string]: unknown
}

export type ChromeManifest = Partial<chrome.runtime.ManifestV2> &
  Partial<chrome.runtime.ManifestV3> & {
    browser_action?: {
      theme_icons?: ThemeIcon[]
    }
    // Firefox supports theme_icons on the MV3 action (light/dark toolbar
    // icons), which @types/chrome does not model.
    action?: chrome.runtime.ManifestV3['action'] & {
      theme_icons?: ThemeIcon[]
    }
    // Extension.js augments the standard omnibox shape with a `default_icon`
    // (string path or per-size record), which `@types/chrome` does not model.
    omnibox?: {
      keyword?: string
      default_icon?: string | Record<string, string>
    }
    // Firefox-only theming key (absent from `@types/chrome`).
    theme_experiment?: ThemeExperiment
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
  transpilePackages?: string[]
  devSession?: boolean
}

export interface LoaderInterface extends RspackLoaderContext<LoaderInterface> {
  manifestPath: string
  includeList?: FilepathList
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

export interface LoaderContext {
  resourcePath: string
  emitFile: (name: string, content: string) => void
  emitWarning?: (error: Error | string) => void
  getOptions: () => {
    test: string
    manifestPath: string
    browser?: DevOptions['browser']
    includeList?: FilepathList
    mode: string
  }
}

export interface JsFramework {
  plugins: RspackPluginInstance[] | undefined
  loaders: Record<string, unknown>[] | undefined
  alias: Record<string, string> | undefined
}

import type {Configuration} from '@rspack/core'
import type {SafariPackageSummary} from './lib/build-summary'
import type {CompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/types'

export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'yandex'
  | 'waterfox'
  | 'librewolf'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'

export interface BrowserOptionsBase {
  noOpen?: boolean
  profile?: string | false
  persistProfile?: boolean
  keepProfileChanges?: boolean
  copyFromProfile?: string
  startingUrl?: string
  browser: BrowserType
}

export interface ChromiumOptions extends BrowserOptionsBase {
  browser: 'chromium-based'
  chromiumBinary?: string
}

export interface GeckoOptions extends BrowserOptionsBase {
  browser: 'gecko-based'
  geckoBinary?: string
}

export interface SafariOptions extends BrowserOptionsBase {
  browser: 'webkit-based'
  safariBinary?: string
  appName?: string
  bundleId?: string
  developmentTeam?: string
  macOsOnly?: boolean
}

export interface SafariPackagerOverrides {
  appName?: string
  bundleId?: string
  developmentTeam?: string
  macOsOnly?: boolean
  forceRegenerate?: boolean
  safariBinary?: string
  noOpen?: boolean
}

export type SafariPackagerFn = (
  distPath: string,
  mode: 'full' | 'resync',
  overrides?: SafariPackagerOverrides
) => Promise<SafariPackageSummary | void>

export interface NonBinaryOptions extends BrowserOptionsBase {
  browser: Exclude<
    BrowserType,
    'chromium-based' | 'gecko-based' | 'webkit-based'
  >
}

export interface DevOptions extends BrowserOptionsBase {
  mode: 'development' | 'production' | 'none'
  polyfill?: boolean
  port?: string | number | undefined
  host?: string
  publicHost?: string
  install?: boolean
  extensions?: CompanionExtensionsConfig
  noBrowser?: boolean
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'
  logContexts?: (
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  )[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
  hashContentScripts?: boolean
  allowControl?: boolean
  allowEval?: boolean
  // When true, a failed dev session calls process.exit(1) (CLI wrapper passes
  // this); defaults to false: as a library, a failure is a rejected promise.
  exitOnError?: boolean
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  developmentTeam?: SafariOptions['developmentTeam']
  macOsOnly?: SafariOptions['macOsOnly']
  forceRegenerate?: boolean
  safariPackager?: SafariPackagerFn
}

export interface BuildOptions {
  browser: BrowserOptionsBase['browser']
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  extensions?: CompanionExtensionsConfig
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
  silent?: boolean
  addonLint?: boolean
  mode?: 'development' | 'production' | 'none'
  install?: boolean
  failOnWarning?: boolean
  // When true, a failed build calls process.exit(1) (CLI wrapper passes this);
  // defaults to false: as a library, a failed build is a rejected promise.
  exitOnError?: boolean
  metadataCommand?: 'dev' | 'start' | 'preview' | 'build'
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  developmentTeam?: SafariOptions['developmentTeam']
  macOsOnly?: SafariOptions['macOsOnly']
  forceRegenerate?: boolean
  safariPackager?: SafariPackagerFn
}

export interface PreviewOptions extends BrowserOptionsBase {
  mode: 'production'
  outputPath?: string
  metadataCommand?: 'dev' | 'start' | 'preview' | 'build'
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  extensions?: CompanionExtensionsConfig
  noBrowser?: boolean
  instanceId?: string
  instanceExplicit?: boolean
  dryRun?: boolean
  // Port forwarding to browser runner (e.g., debugging/logging server)
  port?: string | number
  host?: string
  publicHost?: string
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'
  logContexts?: (
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  )[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

export interface StartOptions extends BrowserOptionsBase {
  mode: 'production'
  polyfill?: boolean
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  extensions?: CompanionExtensionsConfig
  install?: boolean
  noBrowser?: boolean
  // Port forwarding to browser runner (e.g., debugging/logging server)
  port?: string | number
  host?: string
  publicHost?: string
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'
  logContexts?: (
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  )[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

export interface BrowserConfig extends BrowserOptionsBase {
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  preferences?: Record<string, unknown>
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  developmentTeam?: SafariOptions['developmentTeam']
  macOsOnly?: SafariOptions['macOsOnly']
  extensions?: CompanionExtensionsConfig
}

export type OutputConfig = {
  clean: boolean
  path: string
  finalPath?: string
}

export type PerfBudgetsConfig = Partial<
  Record<import('./plugin-perf-budgets').AssetCategory, number>
>

export interface CommonWebpackOptions {
  output: OutputConfig
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  transpilePackages?: string[]
  perfBudgets?: PerfBudgetsConfig
  extensions?: CompanionExtensionsConfig
  instanceId?: string
  controlPort?: number | null
  controlPath?: string
  logsPath?: string
}

export type WebpackConfigOptions = CommonWebpackOptions &
  Omit<
    Partial<DevOptions & PreviewOptions & StartOptions & BuildOptions>,
    'mode'
  > & {
    browser: BrowserType
    mode: 'development' | 'production' | 'none'
    // Injected by command-dev: the browser-runner plugin (Chromium/Firefox
    // launcher or the Safari packager). Both implement RunnerPlugin.
    browsersPlugin?: import('./plugin-browsers').RunnerPlugin
  }

export interface FileConfig {
  browser?: {
    [K in BrowserType]?: BrowserConfig
  }
  commands?: {
    dev?: Pick<
      DevOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'safariBinary'
      | 'appName'
      | 'bundleId'
      | 'macOsOnly'
      | 'noOpen'
      | 'noBrowser'
      | 'polyfill'
    > &
      Pick<
        DevOptions,
        | 'logLevel'
        | 'logContexts'
        | 'logFormat'
        | 'logTimestamps'
        | 'logColor'
        | 'logUrl'
        | 'logTab'
        | 'hashContentScripts'
      > & {
        browserFlags?: string[]
        excludeBrowserFlags?: string[]
        preferences?: Record<string, unknown>
        persistProfile?: boolean
        extensions?: CompanionExtensionsConfig
        transpilePackages?: string[]
        perfBudgets?: PerfBudgetsConfig
      }

    start?: Pick<
      StartOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'polyfill'
      | 'noBrowser'
      | 'port'
      | 'host'
      | 'publicHost'
      | 'logLevel'
      | 'logContexts'
      | 'logFormat'
      | 'logTimestamps'
      | 'logColor'
      | 'logUrl'
      | 'logTab'
    > & {
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
      persistProfile?: boolean
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
    }

    preview?: Pick<
      PreviewOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'noBrowser'
      | 'port'
      | 'host'
      | 'publicHost'
      | 'logLevel'
      | 'logContexts'
      | 'logFormat'
      | 'logTimestamps'
      | 'logColor'
      | 'logUrl'
      | 'logTab'
    > & {
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
      persistProfile?: boolean
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
    }

    build?: Pick<
      BuildOptions,
      | 'browser'
      | 'zipFilename'
      | 'zip'
      | 'zipSource'
      | 'polyfill'
      | 'silent'
      | 'addonLint'
      | 'safariBinary'
      | 'appName'
      | 'bundleId'
      | 'macOsOnly'
    > & {
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
      perfBudgets?: PerfBudgetsConfig
    }
  }
  extensions?: CompanionExtensionsConfig
  transpilePackages?: string[]
  perfBudgets?: PerfBudgetsConfig
  config?: (config: Configuration) => Configuration
}
