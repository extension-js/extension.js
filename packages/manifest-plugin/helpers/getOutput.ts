import type {OutputPath} from '../types'

export default function getOutput(entries?: OutputPath) {
  return {
    background:
      (entries != null && entries.background) || '[feature].[name].[ext]',
    content_scripts:
      (entries != null && entries.contentScripts) || '[feature].[name].[ext]',
    action: (entries != null && entries.action) || '[feature].[name].[ext]',
    chrome_url_overrides:
      (entries != null && entries.newtab) || '[feature].[name].[ext]',
    devtools_page:
      (entries != null && entries.devtools) || '[feature].[name].[ext]',
    options_ui:
      (entries != null && entries.options) || '[feature].[name].[ext]',
    sandbox: (entries != null && entries.sandbox) || '[feature].[name].[ext]',
    sidebar_action:
      (entries != null && entries.sidebar) || '[feature].[name].[ext]',
    chrome_settings_overrides:
      (entries != null && entries.settings) || '[feature].[name].[ext]',
    user_scripts:
      (entries != null && entries.userScripts) || '[feature].[name].[ext]',
    web_accessible_resources:
      (entries != null && entries.webResources) || '[feature]/[name].[ext]',
    icons: (entries != null && entries.action) || '[feature]/[name].[ext]',
    action_icon:
      (entries != null && entries.action) || '[feature]/[name].[ext]',
    settings_icon:
      (entries != null && entries.settings) || '[feature]/[name].[ext]',
    sidebar_icon:
      (entries != null && entries.sidebar) || '[feature]/[name].[ext]',
    declarative_net_request:
      (entries != null && entries.declarativeNetRequest) ||
      '[feature].[name].[ext]',
    storage: (entries != null && entries.storage) || '[feature].[name].[ext]',
    side_panel:
      (entries != null && entries.sidePanel) || '[feature].[name].[ext]'
  }
}
