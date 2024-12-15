import {Configuration} from 'webpack'

export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium-based'
  | 'gecko-based'
  | 'safari'
  | 'webkit-based'

export interface BrowserOptionsBase {
  open?: boolean
  profile?: string
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

export interface WebKitOptions extends BrowserOptionsBase {
  browser: 'gecko-based'
  webKitBinary?: string
}

export interface NonBinaryOptions extends BrowserOptionsBase {
  browser: Exclude<
    BrowserType,
    'chromium-based' | 'gecko-based' | 'webkit-based'
  >
}

export type ExtendedBrowserOptions =
  | ChromiumOptions
  | GeckoOptions
  | WebKitOptions
  | NonBinaryOptions

export interface DevOptions extends BrowserOptionsBase {
  mode: 'development' | 'production'
  polyfill?: boolean
  // Narrow down the options based on `browser`
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  webKitBinary?: WebKitOptions['webKitBinary']
}

export interface BuildOptions {
  browser: BrowserOptionsBase['browser']
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
  silent?: boolean
}

export interface PreviewOptions extends BrowserOptionsBase {
  mode: 'production'
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  webKitBinary?: WebKitOptions['webKitBinary']
}

export interface StartOptions extends BrowserOptionsBase {
  mode: 'production'
  polyfill?: boolean
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  webKitBinary?: WebKitOptions['webKitBinary']
}

export interface BrowserConfig extends BrowserOptionsBase {
  browserFlags?: string[]
  preferences?: Record<string, unknown>
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  webKitBinary?: WebKitOptions['webKitBinary']
}

export interface XCodeConfig {
  // Based off XCode's --project-location
  // Save the generated app and Xcode project to the file path.
  // Defaults to: xcode
  projectLocation?: string

  // Based off XCode's --rebuild-project
  // Rebuild the existing Safari web extension Xcode project at the
  // file path with different options or platforms. Use this option
  // to add iOS to your existing macOS project.
  // Defaults to: false
  rebuildProject?: boolean

  // Based off XCode's --app-name
  // Use the value to name the generated app and the Xcode project.
  // Defaults to: the name of the extension in the manifest.json file.
  appName?: string

  // Based off XCode's --bundle-identifier
  // Use the value as the bundle identifier for the generated app.
  // This identifier is unique to your app in your developer account.
  // A reverse-DNS-style identifier is recommended (for example, com.company.extensionName).
  // Defaults to: org.extensionjs.[extension_name]
  bundleIdentifier?: string

  // Based off XCode's --swift
  // Use Swift in the generated app.
  // Defaults to: true
  swift?: boolean

  // Based off XCode's --objc
  // Use Objective-C in the generated app.
  // Defaults to: false
  objc?: boolean

  // Based off XCode's --ios-only
  // Create an iOS-only project.
  // Defaults to: false
  iosOnly?: boolean

  // Based off XCode's --macos-only
  // Create a macOS-only project.
  // Defaults to: true
  macosOnly?: boolean

  // Based off XCode's --copy-resources
  // Copy the extension files into the generated project.
  // If you don’t specify this parameter, the project references
  // the original extension files.
  // Defaults to: false
  copyResources?: boolean

  // Based off XCode's --no-open
  // Don’t open the generated Xcode project when complete.
  // Defaults to: true
  noOpen?: boolean

  // Based off XCode's --no-prompt
  // Don’t show the confirmation prompt.
  // Defaults to: false
  noPrompt?: boolean

  // Based off XCode's --force
  // Overwrite the output directory, if one exists.
  // Defaults to: false
  force?: boolean
}

export interface FileConfig {
  browser?: {
    chrome?: BrowserConfig
    firefox?: BrowserConfig
    edge?: BrowserConfig
    safari?: BrowserConfig & {xcode?: XCodeConfig}
    'chromium-based'?: BrowserConfig
    'gecko-based'?: BrowserConfig
    'webkit-based'?: BrowserConfig & {xcode?: XCodeConfig}
  }
  commands?: {
    dev?: Pick<
      DevOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'webKitBinary'
      | 'open'
      | 'polyfill'
    > & {
      browserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    start?: Pick<
      StartOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'webKitBinary'
      | 'polyfill'
    > & {
      browserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    preview?: Pick<
      PreviewOptions,
      'browser' | 'profile' | 'chromiumBinary' | 'geckoBinary' | 'webKitBinary'
    > & {
      browserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    build?: Pick<
      BuildOptions,
      'browser' | 'zipFilename' | 'zip' | 'zipSource' | 'polyfill'
    >
  }
  config?: (config: Configuration) => Configuration
}
