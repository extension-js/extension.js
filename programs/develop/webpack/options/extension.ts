// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

const htmlOutputPath = {
  action: 'action',
  background: '/background',
  newtab: '/newtab',
  history: '/history',
  bookmarks: '/bookmarks',
  devtools: '/devtools',
  options: '/options',
  sidebar: '/sidebar',
  settings: '/settings'
  // TODO: check
  // sandbox: 'sandbox',
}

const scriptsOutputPath = {
  contentScripts: '/content-script-[index]',
  background: '/background',
  serviceWorker: '/service-worker',
  userScripts: '/user-scripts'
}

const iconsOutputPath = {
  icons: 'icons',
  action: htmlOutputPath.action,
  settings: htmlOutputPath.settings,
  sidebar: htmlOutputPath.sidebar
}

const webResoucesOutputPath = {
  webResources: '/web-accessible-resources'
}

// Below refers to the output path of each feature
const manifestOutputPath = {
  // HtmlPlugin
  ...htmlOutputPath,
  // ScriptsPlugin
  ...scriptsOutputPath,
  contentScripts: 'content-script-[index]',
  // IconsPlugin
  ...iconsOutputPath,
  // WebResources plugin
  ...webResoucesOutputPath
}

export {
  htmlOutputPath,
  scriptsOutputPath,
  iconsOutputPath,
  webResoucesOutputPath,
  manifestOutputPath
}
