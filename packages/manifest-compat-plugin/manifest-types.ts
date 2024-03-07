export type ManifestIcons = Record<number, string>

export interface SearchProvider {
  name?: string | undefined
  keyword?: string | undefined
  favicon_url?: string | undefined
  search_url: string
  encoding?: string | undefined
  suggest_url?: string | undefined
  instant_url?: string | undefined
  image_url?: string | undefined
  search_url_post_params?: string | undefined
  suggest_url_post_params?: string | undefined
  instant_url_post_params?: string | undefined
  image_url_post_params?: string | undefined
  alternate_urls?: string[] | undefined
  prepopulated_id?: number | undefined
  is_default?: boolean | undefined
}

export interface ManifestAction {
  default_icon?: ManifestIcons | undefined
  default_title?: string | undefined
  default_popup?: string | undefined
}

// Source: https://developer.chrome.com/docs/extensions/mv3/declare_permissions/
export type ManifestPermissions =
  | 'activeTab'
  | 'alarms'
  | 'background'
  | 'bookmarks'
  | 'browsingData'
  | 'certificateProvider'
  | 'clipboardRead'
  | 'clipboardWrite'
  | 'contentSettings'
  | 'contextMenus'
  | 'cookies'
  | 'debugger'
  | 'declarativeContent'
  | 'declarativeNetRequest'
  | 'declarativeNetRequestFeedback'
  | 'declarativeNetRequestWithHostAccess'
  | 'declarativeWebRequest'
  | 'desktopCapture'
  | 'documentScan'
  | 'downloads'
  | 'downloads.shelf'
  | 'downloads.ui'
  | 'enterprise.deviceAttributes'
  | 'enterprise.hardwarePlatform'
  | 'enterprise.networkingAttributes'
  | 'enterprise.platformKeys'
  | 'experimental'
  | 'favicon'
  | 'fileBrowserHandler'
  | 'fileSystemProvider'
  | 'fontSettings'
  | 'gcm'
  | 'geolocation'
  | 'history'
  | 'identity'
  | 'identity.email'
  | 'idle'
  | 'loginState'
  | 'management'
  | 'nativeMessaging'
  | 'notifications'
  | 'offscreen'
  | 'pageCapture'
  | 'platformKeys'
  | 'power'
  | 'printerProvider'
  | 'printing'
  | 'printingMetrics'
  | 'privacy'
  | 'processes'
  | 'proxy'
  | 'scripting'
  | 'search'
  | 'sessions'
  | 'sidePanel'
  | 'signedInDevices'
  | 'storage'
  | 'system.cpu'
  | 'system.display'
  | 'system.memory'
  | 'system.storage'
  | 'tabCapture'
  | 'tabGroups'
  | 'tabs'
  | 'topSites'
  | 'tts'
  | 'ttsEngine'
  | 'unlimitedStorage'
  | 'vpnProvider'
  | 'wallpaper'
  | 'webNavigation'
  | 'webRequest'
  | 'webRequestBlocking'

export interface ManifestBase {
  // Required
  manifest_version: number
  name: string
  version: string

  // Recommended
  default_locale?: string | undefined
  description?: string | undefined
  icons?: ManifestIcons | undefined

  // Optional
  author?:
    | {
        email: string
      }
    | undefined
  background_page?: string | undefined
  chrome_settings_overrides?:
    | {
        homepage?: string | undefined
        search_provider?: SearchProvider | undefined
        startup_pages?: string[] | undefined
      }
    | undefined
  chrome_ui_overrides?:
    | {
        bookmarks_ui?:
          | {
              remove_bookmark_shortcut?: boolean | undefined
              remove_button?: boolean | undefined
            }
          | undefined
      }
    | undefined
  chrome_url_overrides?:
    | {
        bookmarks?: string | undefined
        history?: string | undefined
        newtab?: string | undefined
      }
    | undefined
  commands?:
    | Record<
        string,
        {
          suggested_key?:
            | {
                default?: string | undefined
                windows?: string | undefined
                mac?: string | undefined
                chromeos?: string | undefined
                linux?: string | undefined
              }
            | undefined
          description?: string | undefined
          global?: boolean | undefined
        }
      >
    | undefined
  content_capabilities?:
    | {
        matches?: string[] | undefined
        permissions?: string[] | undefined
      }
    | undefined
  content_scripts?:
    | Array<{
        matches?: string[] | undefined
        exclude_matches?: string[] | undefined
        css?: string[] | undefined
        js?: string[] | undefined
        run_at?: string | undefined
        all_frames?: boolean | undefined
        match_about_blank?: boolean | undefined
        include_globs?: string[] | undefined
        exclude_globs?: string[] | undefined
      }>
    | undefined
  converted_from_user_script?: boolean | undefined
  current_locale?: string | undefined
  devtools_page?: string | undefined
  event_rules?:
    | Array<{
        event?: string | undefined
        actions?:
          | Array<{
              type: string
            }>
          | undefined
        conditions?:
          | chrome.declarativeContent.PageStateMatcherProperties[]
          | undefined
      }>
    | undefined
  externally_connectable?:
    | {
        ids?: string[] | undefined
        matches?: string[] | undefined
        accepts_tls_channel_id?: boolean | undefined
      }
    | undefined
  file_browser_handlers?:
    | Array<{
        id?: string | undefined
        default_title?: string | undefined
        file_filters?: string[] | undefined
      }>
    | undefined
  file_system_provider_capabilities?:
    | {
        configurable?: boolean | undefined
        watchable?: boolean | undefined
        multiple_mounts?: boolean | undefined
        source?: string | undefined
      }
    | undefined
  homepage_url?: string | undefined
  import?:
    | Array<{
        id: string
        minimum_version?: string | undefined
      }>
    | undefined
  export?:
    | {
        whitelist?: string[] | undefined
      }
    | undefined
  incognito?: string | undefined
  input_components?:
    | Array<{
        name?: string | undefined
        type?: string | undefined
        id?: string | undefined
        description?: string | undefined
        language?: string[] | string | undefined
        layouts?: string[] | undefined
        indicator?: string | undefined
      }>
    | undefined
  key?: string | undefined
  minimum_chrome_version?: string | undefined
  nacl_modules?:
    | Array<{
        path: string
        mime_type: string
      }>
    | undefined
  oauth2?:
    | {
        client_id: string
        scopes?: string[] | undefined
      }
    | undefined
  offline_enabled?: boolean | undefined
  omnibox?:
    | {
        keyword: string
      }
    | undefined
  options_page?: string | undefined
  options_ui?:
    | {
        page?: string | undefined
        chrome_style?: boolean | undefined
        open_in_tab?: boolean | undefined
      }
    | undefined
  platforms?:
    | Array<{
        nacl_arch?: string | undefined
        sub_package_path: string
      }>
    | undefined
  plugins?:
    | Array<{
        path: string
      }>
    | undefined
  requirements?:
    | {
        '3D'?:
          | {
              features?: string[] | undefined
            }
          | undefined
        plugins?:
          | {
              npapi?: boolean | undefined
            }
          | undefined
      }
    | undefined
  sandbox?:
    | {
        pages: string[]
        content_security_policy?: string | undefined
      }
    | undefined
  short_name?: string | undefined
  spellcheck?:
    | {
        dictionary_language?: string | undefined
        dictionary_locale?: string | undefined
        dictionary_format?: string | undefined
        dictionary_path?: string | undefined
      }
    | undefined
  storage?:
    | {
        managed_schema: string
      }
    | undefined
  tts_engine?:
    | {
        voices: Array<{
          voice_name: string
          lang?: string | undefined
          gender?: string | undefined
          event_types?: string[] | undefined
        }>
      }
    | undefined
  update_url?: string | undefined
  version_name?: string | undefined
  [key: string]: any
}

export interface ManifestV2 extends ManifestBase {
  // Required
  manifest_version: 2

  // Pick one (or none)
  browser_action?: ManifestAction | undefined
  page_action?: ManifestAction | undefined

  // Optional
  background?:
    | {
        scripts?: string[] | undefined
        page?: string | undefined
        persistent?: boolean | undefined
      }
    | undefined
  content_security_policy?: string | undefined
  optional_permissions?: string[] | undefined
  permissions?: string[] | undefined
  web_accessible_resources?: string[] | undefined
}

export interface ManifestV3 extends ManifestBase {
  // Required
  manifest_version: 3

  // Optional
  action?: ManifestAction | undefined
  background?:
    | {
        service_worker: string
        type?: 'module' // If the service worker uses ES modules
      }
    | undefined
  content_scripts?:
    | Array<{
        matches?: string[] | undefined
        exclude_matches?: string[] | undefined
        css?: string[] | undefined
        js?: string[] | undefined
        run_at?: string | undefined
        all_frames?: boolean | undefined
        match_about_blank?: boolean | undefined
        include_globs?: string[] | undefined
        exclude_globs?: string[] | undefined
        world?: 'ISOLATED' | 'MAIN' | undefined
      }>
    | undefined
  content_security_policy?: {
    extension_pages?: string
    sandbox?: string
  }
  host_permissions?: string[] | undefined
  optional_permissions?: ManifestPermissions[] | undefined
  optional_host_permissions?: string[] | undefined
  permissions?: ManifestPermissions[] | undefined
  web_accessible_resources?:
    | Array<{resources: string[]; matches: string[]}>
    | undefined
}

export type Manifest = ManifestV2 | ManifestV3
