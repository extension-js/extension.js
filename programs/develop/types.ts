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
import type {LogContext} from './dev-server/control-bridge/contracts'
import type {DevAddition} from './lib/dev-additions'
import type {DevSessionCoordinates} from './lib/dev-session-coordinates'
import type {ManagedExtensionRecord} from './lib/extension-id'
import type {ManifestV2, ManifestV3} from './lib/manifest-types'
import type {ErrorCode} from './lib/messaging'

/**
 * Firefox-only `theme_experiment` manifest key.
 * Not present in `@types/chrome`; declared here so the manifest pipeline can
 * read it type-safely instead of casting `manifest as any`.
 * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme_experiment
 */
export interface ThemeExperiment {
  stylesheet?: string
  stylesheets?: string[]
  // Firefox also allows colors/images/properties maps; kept open for forward-compat.
  [key: string]: unknown
}

// Omit would drop every named key here, since ManifestBase carries a string
// index signature, so the key is removed with a remapped mapped type instead.
type WithoutManifestVersion<T> = {
  [K in keyof T as Exclude<K, 'manifest_version'>]: T[K]
}

export type ChromeManifest = WithoutManifestVersion<Partial<ManifestV2>> &
  WithoutManifestVersion<Partial<ManifestV3>> & {
    // Intersecting the two Partials collapses manifest_version to never, so
    // it is declared once here with the two values the engine accepts.
    manifest_version?: 2 | 3
    browser_action?: {
      theme_icons?: ThemeIcon[]
    }
    // Firefox supports theme_icons on the MV3 action (light/dark toolbar
    // icons), which @types/chrome does not model.
    action?: ManifestV3['action'] & {
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
  /** The HTML page entries of this build, for a step that reads page scripts. */
  pageList?: FilepathList
  transpilePackages?: string[]
  /**
   * Compile-time constants, each value JSON-serialized into the bundle the
   * way Vite does it. `browser.<vendor>.define` adds to or overrides the
   * top-level map for that browser.
   */
  define?: Record<string, unknown>
  /** True inside `extension dev`: the one axis that turns dev instrumentation
   * (dev CSP, injected permissions, reload client, page HMR) on. A build in
   * development mode is shippable and keeps the author's manifest. */
  devSession?: boolean
  /** The host this dev session's browser dials, given by the session that
   * builds the config, so another session's environment does not name it. */
  connectableHost?: string
  /** The port this dev session's server listens on, for its page HMR client. */
  port?: string | number
  /** The record of the dev session that builds the config, when one does. */
  session?: Readonly<DevSessionCoordinates>
}

export interface LoaderInterface extends RspackLoaderContext<LoaderInterface> {
  manifestPath: string
  includeList?: FilepathList
}

export type FilepathList = Record<string, string | string[] | undefined>

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
import type {CompanionExtensionsConfig} from './lib/companion-extensions/types'

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
  | 'zen'
  | 'floorp'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'
  | 'chromium-emulator'

export interface BrowserOptionsBase {
  noOpen?: boolean
  profile?: string | false
  /**
   * Opt-in persistent managed profile for development.
   * Defaults to false (ephemeral temp profiles are used).
   */
  persistProfile?: boolean
  /**
   * Keep the managed profile and its changes across runs (persistent `dev`
   * profile, skipped by cleanup). Seeded once when combined with
   * `copyFromProfile`.
   */
  keepProfileChanges?: boolean
  /**
   * Seed the managed profile as a copy of this profile directory on first
   * creation.
   */
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
  /** Override the Safari app name (defaults to the manifest name). */
  appName?: string
  /** User-owned bundle identifier (defaults to a dev.extensionjs.* id). */
  bundleId?: string
  developmentTeam?: string
  /** Generate the macOS-only Xcode project (default true). */
  macOsOnly?: boolean
  /**
   * A square PNG (1024 px) the Safari app's icon set is made from, relative to
   * the project. Unset, Apple's converter builds it from the manifest icons.
   */
  appIcon?: string
  /** Regenerate the Xcode project even when its fingerprint is current. */
  forceRegenerate?: boolean
}

/**
 * Safari identity/packaging options resolved by develop (CLI flags merged
 * with extension.config.js `browser.safari`) and forwarded to the packager
 * the CLI injects.
 */
export interface SafariPackagerOverrides {
  appName?: string
  bundleId?: string
  developmentTeam?: string
  macOsOnly?: boolean
  /** Absolute path of the PNG the app icon set is made from. */
  appIcon?: string
  forceRegenerate?: boolean
  safariBinary?: string
  /** When set, overrides the factory `noOpen` for this packaging call. */
  noOpen?: boolean
  /** Opened in the automation window once the dev session holds one. */
  startingUrl?: string
}

/**
 * The packaging callback develop calls once the Safari dist is on disk. The
 * CLI injects `createSafariPackager()` from `extension/browsers`; a library
 * caller must inject the same thing or no Safari app is produced at all.
 * Returning a summary is optional so older packagers keep type-checking.
 */
export type SafariPackagerFn = (
  distPath: string,
  mode: 'full' | 'resync',
  overrides?: SafariPackagerOverrides
) => Promise<SafariPackageSummary | void>

/** The command a run is recorded under in `ready.json` and `events.ndjson`. */
export type SessionCommand = 'dev' | 'start' | 'preview' | 'build'

/** Which browser logs a session prints and how, for dev, start and preview. */
export interface LogOptions {
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'
  logContexts?: LogContext[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

// Each Public*Options type is what the package entry exports under the plain
// name. The plain name here adds the fields only the CLI and the engine set.
// Dev always compiles in development and writes no archive, so the build's
// mode, zip and source map fields are not on this type.
export interface PublicDevOptions extends BrowserOptionsBase, LogOptions {
  polyfill?: boolean
  port?: string | number | undefined
  /**
   * Host to bind the dev server to.
   * Use '0.0.0.0' for Docker/devcontainer environments.
   * Defaults to '127.0.0.1'.
   */
  host?: string
  /**
   * Connectable host the browser (HMR client + control-bridge producer) dials,
   * when it differs from the bind `host` (e.g. a remote/devcontainer). Defaults
   * to the bind host, or 127.0.0.1 when bound to a wildcard like '0.0.0.0'.
   */
  publicHost?: string
  /**
   * Extra Host names the dev server answers, beyond localhost, IP literals and
   * `publicHost` (a docker service name, a tunnel, a *.local name). A comma
   * list or an array. A leading dot allows every subdomain.
   */
  allowedHosts?: string | string[]
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Skip launching the browser (dev server still starts).
   */
  noBrowser?: boolean
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  hashContentScripts?: boolean
  /**
   * Open the agent-bridge control channel for the bounded act verbs
   * (storage/reload/open). The CLI sets this from `--allow-control`.
   */
  allowControl?: boolean
  /**
   * Additionally allow the `eval` verb, which runs arbitrary code inside a
   * context and writes a 0600 session token. Implies `allowControl`, since
   * eval is strictly stronger. The CLI sets this from `--allow-eval`.
   */
  allowEval?: boolean
  // When true, a failed dev session calls process.exit(1) (CLI wrapper passes
  // this); defaults to false: as a library, a failure is a rejected promise.
  exitOnError?: boolean
  /** The hint a host wants on the terminal `failed` or `usage` frame of a code. */
  hintFor?: (code: ErrorCode) => string | undefined
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  developmentTeam?: SafariOptions['developmentTeam']
  macOsOnly?: SafariOptions['macOsOnly']
  appIcon?: SafariOptions['appIcon']
  forceRegenerate?: boolean
  safariPackager?: SafariPackagerFn
}

export interface DevOptions extends PublicDevOptions {
  /** Auto-install project dependencies when missing. */
  install?: boolean
  // The engine's own: the plugins share this shape and read the mode the
  // command compiles in, which for dev is always development.
  mode?: 'development' | 'production' | 'none'
}

export interface PublicBuildOptions {
  browser: BrowserOptionsBase['browser']
  /**
   * Base folder for the build output, relative to the project root. The
   * build writes `<outDir>/<browser>` instead of `dist/<browser>`, zip
   * included, so it can run beside a dev session that serves `dist`.
   */
  outDir?: string
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  zipFilename?: string
  /**
   * Folder the archives are written to, relative to the project root or
   * absolute. Defaults to the folder that holds the browser output, `dist`.
   * The file name and its browser suffix stay as `zipFilename` sets them.
   */
  zipDir?: string
  zip?: boolean
  zipSource?: boolean
  /**
   * Write a `.map` file beside each script and stylesheet of a production
   * build. The maps stay out of the zip. Defaults to `false`.
   */
  sourceMaps?: boolean
  polyfill?: boolean
  /**
   * Print nothing on stdout. Warnings stay in the returned summary and in
   * `build-summary.json`, and a failure still prints. Defaults to `false`.
   */
  silent?: boolean
  /**
   * Run Mozilla's addons-linter over the emitted dist after a production
   * build for a Gecko target and print its findings as build warnings.
   * Needs `addons-linter` installed in the project. Defaults to `true`.
   */
  addonLint?: boolean
  /**
   * Minify first-party code in production builds. Defaults to `true` for
   * every target but `opera`, whose store reviews readable source only.
   */
  minify?: boolean
  /**
   * Override the bundler mode. 'development' and 'production' also set
   * NODE_ENV for the length of the build, and 'none' leaves it as the
   * caller set it. Defaults to 'production' to preserve historical
   * behavior. Setting 'development' is useful for
   * staging/QA dists that should still pass through the bundler's debug
   * pipeline (sourcemaps, looser minification). Mirrors `vite build --mode`
   * and `webpack --mode`. The artifact stays shippable: it carries the
   * author's CSP and permissions, no reload client, and its zip holds no
   * maps. Only `extension dev` turns the dev instrumentation on.
   */
  mode?: 'development' | 'production' | 'none'
  /**
   * @deprecated Nothing reads it. A build never fails on a warning.
   */
  failOnWarning?: boolean
  /**
   * @deprecated A build ignores it. A failed build rejects and the caller owns the exit.
   */
  exitOnError?: boolean
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  developmentTeam?: SafariOptions['developmentTeam']
  macOsOnly?: SafariOptions['macOsOnly']
  appIcon?: SafariOptions['appIcon']
  forceRegenerate?: boolean
  safariPackager?: SafariPackagerFn
}

export interface BuildOptions extends PublicBuildOptions {
  /** Auto-install project dependencies when missing. */
  install?: boolean
  /**
   * The command stamped into ready.json/events.ndjson. Defaults to
   * 'build'; `extension start` passes 'start' for its build phase so the
   * receipt names the command the user actually ran.
   */
  metadataCommand?: SessionCommand
  /**
   * `extension start` sets it when a browser launch follows the build, so
   * the receipt stays `starting` with `compiledAt` set and only the launch
   * phase stamps `ready`.
   */
  launchFollows?: boolean
}

export interface PublicPreviewOptions extends BrowserOptionsBase, LogOptions {
  /**
   * @deprecated Nothing reads it: a preview always runs a finished build.
   * Kept optional so a caller that still passes it compiles.
   */
  mode?: 'production'
  outputPath?: string
  // Launch options the config file also takes. A value passed here wins.
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  preferences?: Record<string, unknown>
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Skip launching the browser (no preview window).
   */
  noBrowser?: boolean
  /**
   * Open the agent-bridge control channel on the production run, so the act
   * verbs (storage/reload/open) reach it. The browser loads a copy of the
   * build with the control producer prepended; dist/ stays the shipped bytes.
   * The CLI sets this from `start --allow-control`.
   */
  allowControl?: boolean
  /**
   * Additionally allow `eval` on the production run. Implies `allowControl`.
   * The CLI sets this from `start --allow-eval`.
   */
  allowEval?: boolean
  /**
   * Dry run mode (no browser launch) for diagnostics.
   */
  dryRun?: boolean
  /**
   * Seeds the browser's debugging port, which the launcher derives from it.
   * This command serves nothing, so it is not a server port.
   */
  port?: string | number
  /**
   * Host the control channel binds to when `allowControl` or `allowEval`
   * opens one. Nothing else listens. Defaults to '127.0.0.1'.
   */
  host?: string
  /**
   * Accepted so a config or flag shared with `dev` keeps working. Nothing is
   * served by this command, so there is no connectable host to override.
   */
  publicHost?: string
}

export interface PreviewOptions extends PublicPreviewOptions {
  /**
   * The command stamped into ready.json, set by start when it hands over to
   * preview. The full union, so the bundler options type does not narrow it.
   */
  metadataCommand?: SessionCommand
  /** Auto-generated instance ID, not user-configurable. */
  instanceId?: string
  /** True when the instance ID came from the user, not autogenerated. */
  instanceExplicit?: boolean
}

export interface PublicStartOptions extends BrowserOptionsBase, LogOptions {
  mode: 'production'
  polyfill?: boolean
  // Launch options the config file also takes. A value passed here wins.
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  preferences?: Record<string, unknown>
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Skip launching the browser (build still runs).
   */
  noBrowser?: boolean
  /**
   * Seeds the browser's debugging port, which the launcher derives from it.
   * This command serves nothing, so it is not a server port.
   */
  port?: string | number
  /**
   * Host the control channel binds to when `allowControl` or `allowEval`
   * opens one. Nothing else listens. Defaults to '127.0.0.1'.
   */
  host?: string
  /**
   * Accepted so a config or flag shared with `dev` keeps working. Nothing is
   * served by this command, so there is no connectable host to override.
   */
  publicHost?: string
}

export interface StartOptions extends PublicStartOptions {
  /** Auto-install project dependencies when missing. */
  install?: boolean
}

export interface BrowserConfig extends Omit<BrowserOptionsBase, 'browser'> {
  /**
   * Optional: the key of the `browser` map already names the target. The map
   * key wins, a different value here changes nothing.
   */
  browser?: BrowserType
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
  appIcon?: SafariOptions['appIcon']
  forceRegenerate?: SafariOptions['forceRegenerate']
  /** Where the special folders live for this browser, or `false` to skip one. */
  folders?: SpecialFoldersConfig
  /** Extra files for this browser's output, added to the top-level `include`. */
  include?: IncludeFilesConfig
  /** Files this browser's build leaves out, added to the top-level `exclude`. */
  exclude?: ExcludeFilesConfig
  /** Transpile allowlist for this browser, over the top-level list. */
  transpilePackages?: string[]
  /** Compile-time constants for this browser, over the top-level map. */
  define?: Record<string, unknown>
  /** Asset budgets for this browser, over the top-level budgets. */
  perfBudgets?: PerfBudgetsConfig
  /**
   * Companion extensions (load-only) scoped to a browser config.
   * Useful for per-browser store URLs or local unpacked extensions.
   */
  extensions?: CompanionExtensionsConfig
}

export type OutputConfig = {
  clean: boolean
  path: string
  /**
   * Internal: the final dist path when `path` points at the staging
   * directory a one-shot build is later promoted from. Metadata surfaces
   * (ready.json) advertise this path, never the staging directory.
   */
  finalPath?: string
}

/**
 * Per-category asset size budgets (bytes) for the perf-budgets plugin, plus
 * `ignore`, the output paths no budget applies to (exact, or `*` and `**`
 * globs). A `.wasm` file only pages and workers reach is budgeted as `wasm`
 * (32 MiB); one a content script or the service worker reaches stays
 * `runtime` (1 MiB). Set at the top level of extension.config.js (weakest),
 * under `browser.<vendor>.perfBudgets`, or under
 * `commands.build.perfBudgets` or `commands.start.perfBudgets` (strongest
 * below a CLI flag). Budgets are checked on a production build only, the
 * one `build` and `start` run. Preview builds nothing, so it takes none.
 * `onExceed: 'error'` makes an overrun fail the build instead of warning.
 */
export type PerfBudgetsConfig =
  import('./plugin-perf-budgets').PerfBudgetsConfig

export interface CommonWebpackOptions {
  output: OutputConfig
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  /**
   * Workspace/dependency packages that should be transpiled from source.
   * Useful for monorepos where package exports point to TS/TSX files.
   */
  transpilePackages?: string[]
  /**
   * Compile-time constants, each value JSON-serialized into the bundle.
   */
  define?: Record<string, unknown>
  folders?: SpecialFoldersConfig
  include?: IncludeFilesConfig
  exclude?: ExcludeFilesConfig
  perfBudgets?: PerfBudgetsConfig
  /**
   * Companion extensions (load-only). Each entry must be an unpacked extension root
   * containing a manifest.json. These are loaded alongside the user extension in
   * dev/preview/start (and can also be applied to build for packaging scenarios).
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Internal auto-generated instance ID, not user-configurable
   */
  instanceId?: string
  /**
   * Agent-bridge control channel. Injected by dev-server so the
   * ReadyContractPlugin can advertise them in ready.json. Not user-configurable.
   */
  controlPort?: number | null
  /**
   * The host this session's browser dials for the control bridge, given by
   * the dev session that builds the config. Not user-configurable.
   */
  connectableHost?: string
  /**
   * Where the dev session that builds the config listens. One record for
   * each compiler, so two sessions in one host never share a value.
   * Not user-configurable.
   */
  session?: Readonly<DevSessionCoordinates>
  controlPortUnavailableReason?: string | null
  controlPath?: string
  logsPath?: string
  /**
   * Set by dev-server when act verbs are allowed and a browser launch
   * follows, so ready.json waits for the background to connect.
   */
  readyAwaitsExecutor?: boolean
}

/**
 * Canonical options type for webpack-config consumers.
 * Accepts any of the command option fields (dev/preview/start/build),
 * while requiring browser and mode, and the common output settings.
 *
 * `mode` is omitted from the partial intersection because PreviewOptions
 * and StartOptions narrow it to `'production'`. Without the omit the
 * outer override below becomes ineffective: TypeScript intersects the
 * outer `'development' | 'production' | 'none'` with the inner
 * `'production'` and the input is locked back to `'production'`.
 */
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
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'safariBinary'
      | 'appName'
      | 'bundleId'
      | 'developmentTeam'
      | 'macOsOnly'
      | 'appIcon'
      | 'forceRegenerate'
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
        // Optional like every key here: the target can come from the flag.
        browser?: BrowserType
        browserFlags?: string[]
        excludeBrowserFlags?: string[]
        preferences?: Record<string, unknown>
        persistProfile?: boolean
        extensions?: CompanionExtensionsConfig
        transpilePackages?: string[]
        define?: Record<string, unknown>
        folders?: SpecialFoldersConfig
        include?: IncludeFilesConfig
        exclude?: ExcludeFilesConfig
        perfBudgets?: PerfBudgetsConfig
      }

    start?: Pick<
      StartOptions,
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'polyfill'
      | 'noOpen'
      | 'startingUrl'
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
      browser?: BrowserType
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
      persistProfile?: boolean
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
      define?: Record<string, unknown>
      folders?: SpecialFoldersConfig
      include?: IncludeFilesConfig
      exclude?: ExcludeFilesConfig
      perfBudgets?: PerfBudgetsConfig
    }

    preview?: Pick<
      PreviewOptions,
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'noOpen'
      | 'startingUrl'
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
      browser?: BrowserType
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
      persistProfile?: boolean
      extensions?: CompanionExtensionsConfig
      /** @deprecated Preview serves an existing build and ignores it. */
      transpilePackages?: string[]
      /** @deprecated Preview serves an existing build and ignores it. */
      define?: Record<string, unknown>
      folders?: SpecialFoldersConfig
    }

    build?: Pick<
      BuildOptions,
      | 'outDir'
      | 'zipFilename'
      | 'zipDir'
      | 'zip'
      | 'zipSource'
      | 'sourceMaps'
      | 'polyfill'
      | 'silent'
      | 'addonLint'
      | 'minify'
      | 'safariBinary'
      | 'appName'
      | 'bundleId'
      | 'developmentTeam'
      | 'macOsOnly'
      | 'appIcon'
      | 'forceRegenerate'
    > & {
      browser?: BrowserType
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
      define?: Record<string, unknown>
      folders?: SpecialFoldersConfig
      include?: IncludeFilesConfig
      exclude?: ExcludeFilesConfig
      perfBudgets?: PerfBudgetsConfig
    }
  }
  /**
   * Companion extensions (load-only) applied to commands unless overridden per-command.
   * This is merged into `commands.dev|start|preview|build` by the config loader.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Default transpile allowlist for all commands, the weakest layer.
   * `browser.<vendor>.transpilePackages` overrides it, and per-command
   * `commands.<name>.transpilePackages` overrides both.
   */
  transpilePackages?: string[]
  /**
   * Compile-time constants for every command, each value JSON-serialized
   * into the bundle the way Vite's define does it. `browser.<vendor>.define`
   * adds to or overrides it for that browser.
   */
  define?: Record<string, unknown>
  /**
   * Default per-category asset budgets for all commands, the weakest layer.
   * `browser.<vendor>.perfBudgets` overrides it, and
   * `commands.build|start.perfBudgets` overrides both.
   */
  perfBudgets?: PerfBudgetsConfig
  /**
   * Where the special folders live. A path points at a folder named like the
   * default (`src/scripts`), `false` turns the folder off. The weakest layer,
   * `browser.<vendor>.folders` and `commands.<name>.folders` override it.
   */
  folders?: SpecialFoldersConfig
  /**
   * Extra files copied into the output, keyed by their output path, for
   * example `{'models/x.onnx': './models/x.onnx'}`. A source can be a file
   * or a folder, inside or outside the project. `browser.<vendor>.include`
   * adds to or overrides it, and `commands.<name>.include` adds to both.
   */
  include?: IncludeFilesConfig
  /**
   * Files the build leaves out, each relative to the project root, for
   * example `['pages/offscreen.html']`. A page or script named here gets no
   * entry and emits nothing, a public file named here is not copied.
   * `browser.<vendor>.exclude` and `commands.<name>.exclude` add to it.
   */
  exclude?: ExcludeFilesConfig
  /**
   * Customizes the bundler config before the compiler is built. The second
   * argument names the target browser, the bundler mode and the command.
   */
  config?: (config: Configuration, context: ConfigHookContext) => Configuration
  /**
   * Runs once the bundler config is final, right before the first build, with
   * every loader rule attached. It can change `module`, `resolve`,
   * `resolveLoader`, `node`, `optimization.minimize`, `optimization.minimizer`
   * and the `output` options read at build time, such as file names and
   * `environment`. Every other key is fixed by then (`entry`, `plugins`,
   * `mode`, `devtool`, `target`, `externals`, `output.path`, the rest of
   * `optimization`): a change is ignored with a warning, use `config`.
   * The second argument is the same context `config` receives.
   */
  configResolved?: (
    config: Configuration,
    context: ConfigHookContext
  ) => Configuration | undefined | Promise<Configuration | undefined>
}

/** What the `config` and `configResolved` hooks are told about the run. */
export interface ConfigHookContext {
  browser: BrowserType
  mode: 'development' | 'production' | 'none'
  command: SessionCommand
  /**
   * The bundler this run compiles with, so a hook reaches `ProvidePlugin`
   * or `NormalModuleReplacementPlugin` with no bundler of the project's own.
   */
  rspack: typeof import('@rspack/core').rspack
}

export interface SpecialFoldersConfig {
  scripts?: string | false
  pages?: string | false
  public?: string | false
}

/**
 * One `include` source in its long form. `minify: false` ships a script as
 * authored where a production build would minify it.
 */
export interface IncludeFileEntry {
  /** The source path, relative to the project root. */
  from: string
  /**
   * Minify a `.js`, `.mjs` or `.cjs` source in a production build. Names
   * are shortened and comments dropped, and no statement is rewritten.
   * Defaults to `true`.
   */
  minify?: boolean
}

/**
 * Extra files for the build output. Each key is the output path, relative
 * to the extension root, and each value the source path, relative to the
 * project root, or `{from, minify}`. A folder source copies its tree under
 * the output path. A production build minifies the scripts among them.
 */
export type IncludeFilesConfig = Record<string, string | IncludeFileEntry>

/**
 * Files the build leaves out, each relative to the project root. A page or
 * script in a special folder named here gets no entry, a public file named
 * here is not copied. The lists of every config layer add up.
 */
export type ExcludeFilesConfig = string[]

/**
 * `ready.json` as the build engine writes it, every field included. A field
 * the browser launcher stamps is listed when the engine carries it across a
 * recompile. Read it with `readReadyContractDocument` from the bridge entry.
 */
export interface ReadyContract {
  /** The contract's own version. */
  schemaVersion: 2
  /** The result envelope version this engine speaks. */
  schema: 1
  /**
   * `starting` until the session is usable, `stopped` once it ended. A held
   * `starting` with `compiledAt` set waits for the browser or its background.
   */
  status: 'starting' | 'ready' | 'error' | 'stopped'
  command: SessionCommand
  browser: string
  runId: string
  /** When the run began (ISO 8601 UTC), kept across recompiles. */
  startedAt: string
  distPath: string
  manifestPath: string
  /** The dev server port, null when the command serves nothing. */
  port: number | null
  host?: string
  pid: number
  /** When the process behind `pid` started, to tell a reused pid apart. */
  pidStartedAt: string
  /** Linux only: boot id and start tick of `pid`, exact across clock steps. */
  pidStartId?: string
  /** When this document was last written. */
  ts: string
  compiledAt: string | null
  errors: string[]
  /** Set with `status: 'error'` or `'stopped'`, and its sentence. */
  code?: string
  message?: string
  /** Set once the session ended as a failure, with the code that ended it. */
  endedAsFailedAt?: string
  endedAsFailedCode?: string
  instanceId?: string
  instanceExplicit?: boolean
  controlPort: number | null
  /** Why `controlPort` is null when a control channel was asked for. */
  controlPortUnavailableReason?: string
  controlPath?: string
  logsPath?: string
  toolchainVersion: string
  extensionName?: string
  extensionVersion?: string
  /** The id the browser serves the build under, and who said so. */
  extensionId?: string
  extensionIdSource?: 'browser' | 'derived' | 'packager'
  /** Set on the emulator target, which has no browser process. */
  engine?: 'emulator'
  /** Every extension loaded besides the project's own. */
  managedExtensions?: ManagedExtensionRecord[]
  /** Dev only: what the session has that a production build does not. */
  devAdditions?: DevAddition[]
  /** Set while a compiled dev session waits for its background to connect. */
  awaitingExecutorSince?: string
  /** `attached` once the background connected, `detached` after it left. */
  runtime?: 'attached' | 'detached'
  executorAttachedAt?: string
  executorDetachedAt?: string
  extensionBaseUrl?: string
  /** Dev only: the last reload applied after a compile. */
  reloadedAt?: string
  reloadKind?: string
  reloadLabel?: string
  // From here on the browser launcher stamps the field after the launch and
  // the engine carries it across every recompile of the same run.
  cdpPort?: number
  cdpFaultCode?: string
  cdpFaultMessage?: string
  rdpPort?: number
  rdpPortError?: string
  webdriverPort?: number
  webdriverSessionId?: string
  webdriverUnavailableReason?: string
  webdriverRequestPath?: string
  /** Safari dev sessions: how far the enable step got and why it stopped. */
  safari?: {
    bundleId: string
    extensionId: string
    team: string
    switchId: string
    enableAttempted: boolean
    step: string
    enabled: boolean | null
    listed: boolean | null
    otherWebsites: string | null
    reason?: string
    earlierExtensionIds?: string[]
  }
  profilePath?: string
  /** True when the launch reused a profile an earlier run left behind. */
  profileReused?: boolean
  /** The profile was locked by another session, and which one holds it. */
  profileLockedAt?: string
  profileLockOwner?: {host: string; pid: number}
  browserPid?: number | null
  browserStartedAt?: string
  /** Linux only: boot id and start tick of `browserPid`, as `pidStartId`. */
  browserStartId?: string
  launcherPid?: number
  launcherStartedAt?: string
  /** Linux only: boot id and start tick of `launcherPid`, as `pidStartId`. */
  launcherStartId?: string
  /** The browser binary that ran, and how it was chosen. */
  binary?: string
  binaryProvenance?: string
  /** What pinned the binary, set only when the provenance is a pin. */
  binaryPinnedBy?: string
  /** The page the browser was asked to open first, and whether it did. */
  startingUrl?: string
  startingUrlOpened?: boolean
  startingUrlUnopenedReason?: string
  browserExitedAt?: string
  browserExitCode?: number | null
  browserExitSignal?: string | null
  browserLaunchFailedAt?: string
  browserLaunchFailedReason?: string
  browserLaunchFailedCode?: string
  /** The browser is up and no background has connected yet. */
  browserUpNotAttachedAt?: string
  browserUpNotAttachedWaitMs?: number
  browserUpNotAttachedHint?: string
  /** The browser refused to load the extension. */
  extensionLoadRefusedAt?: string
  extensionLoadRefusedReason?: string
  extensionLoadRefusedCause?: string
}
