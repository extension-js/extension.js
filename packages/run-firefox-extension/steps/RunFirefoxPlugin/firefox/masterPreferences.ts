// PROFILE PREFS aka "Master Preferences" aka "User Preferences"
// * Official Source code:
//   - https://dxr.mozilla.org/mozilla-release/source/modules/libpref/init/all.js
//   - https://dxr.mozilla.org/mozilla-release/source/browser/app/profile/firefox.js
// * web-ext defaults: https://github.com/mozilla/web-ext/blob/master/src/firefox/preferences.js

// Prefs specific to Firefox for Desktop.
const masterPreferences = {
  // Disable app update.
  'app.update.enabled': false,
  // This preference can be used to turn off DNS prefetch.
  'browser.dns.disablePrefetch': false,
  // Allow debug output via dump to be printed to the system console
  'browser.dom.window.dump.enabled': true,
  // Disable autofill of form fields
  'browser.formfill.enable': false,
  // handle links targeting new windows
  // 1=current window/tab, 2=new window, 3=new tab in most recent window
  'browser.link.open_newwindow': 3,
  // Google Safe Browsing provider (legacy)
  'browser.safebrowsing.provider.google.updateURL':
    'http://localhost/safebrowsing-dummy/newkey',
  'browser.safebrowsing.provider.google.gethashURL':
    'http://localhost/safebrowsing-dummy/gethash',
  // Google Safe Browsing provider
  'browser.safebrowsing.provider.google4.updateURL':
    'http://localhost/safebrowsing-dummy/newkey',
  'browser.safebrowsing.provider.google4.gethashURL':
    'http://localhost/safebrowsing-dummy/gethash',
  // Mozilla Safe Browsing provider (for tracking protection and plugin blocking)
  'browser.safebrowsing.provider.mozilla.updateURL':
    'http://localhost/safebrowsing-dummy/newkey',
  'browser.safebrowsing.provider.mozilla.gethashURL':
    'http://localhost/safebrowsing-dummy/gethash',
  'browser.selfsupport.url': 'https://localhost/selfrepair',
  // Disable session restore, which can interfere with extension development by restoring previous state
  'browser.sessionstore.enabled': false,
  // Disable checking if Firefox is the default browser on startup
  'browser.shell.checkDefaultBrowser': false,
  // Disable all syncing services
  'browser.sync.enabled': false,
  // 0 = blank, 1 = home (browser.startup.homepage), 2 = last visited page, 3 = resume previous browser session
  // The behavior of option 3 is detailed at: http://wiki.mozilla.org/Session_Restore
  'browser.startup.page': 0,
  'browser.startup.homepage_welcome_url': 'about:blank',
  'browser.startup.homepage_welcome_url_additional': 'about:blank',
  'browser.urlbar.suggest.bookmark': false,
  'browser.urlbar.suggest.clipboard': false,
  'browser.urlbar.suggest.history': false,
  'browser.urlbar.suggest.openpage': false,
  'browser.urlbar.suggest.remotetab': false,
  'browser.urlbar.suggest.searches': false,
  'browser.urlbar.suggest.topsites': false,
  'browser.urlbar.suggest.engines': false,
  'browser.urlbar.suggest.calculator': false,
  'browser.urlbar.suggest.recentsearches': false,
  // Disable all data submission.
  // Ref: https://firefox-source-docs.mozilla.org/toolkit/components/telemetry/internals/preferences.html#data-choices-notification
  'datareporting.policy.dataSubmissionEnabled': false,
  // Set the policy firstURL to an empty string to prevent the privacy
  // info page to be opened on every run.
  // See https://github.com/mozilla/web-ext/issues/1114
  'datareporting.policy.firstRunURL': '',
  'devtools.browserconsole.contentMessages': true,
  // Enable remote debugging connections.
  'devtools.debugger.remote-enabled': true,
  // Don't show the Browser Toolbox prompt.
  'devtools.debugger.prompt-connection': false,
  'devtools.errorconsole.enabled': true,
  // Only load extensions from the application and user profile.
  // AddonManager.SCOPE_PROFILE + AddonManager.SCOPE_APPLICATION
  // See http://hg.mozilla.org/mozilla-central/file/1dd81c324ac7/build/automation.py.in//l372
  'extensions.installDistroAddons': false,
  // Disable add-ons that are not installed by the user in all scopes by default.
  // See the SCOPE constants for values:
  // https://searchfox.org/mozilla-central/source/services/sync/modules/engines/addons.sys.mjs
  'extensions.autoDisableScopes': 10,
  'extensions.chrome.enabled': true,
  'extensions.logging.enabled': false,
  'extensions.checkCompatibility.nightly': false,
  'extensions.update.enabled': false,
  'extensions.update.notifyUser': false,
  'extensions.enabledScopes': 5,
  'extensions.getAddons.cache.enabled': false,
  // Assuming "disable transaction" refers to disabling network
  // transactions such as prefetch, speculative connect
  'network.prefetch.next': false,
  'network.speculative.preconnect.enabled': false,
  // Disable recovery URLs and telemetry that may transmit data
  // outsideduring development
  'toolkit.telemetry.enabled': false,
  'toolkit.telemetry.archive.enabled': false,
  'toolkit.telemetry.newProfilePing.enabled': false,
  'toolkit.recovery.enabled': false,
  // Make url-classifier updates so rare that they won't affect tests.
  // See http://hg.mozilla.org/mozilla-central/file/1dd81c324ac7/build/automation.py.in//l388
  'urlclassifier.updateinterval': 172800,
  // Allow unsigned add-ons.
  'xpinstall.signatures.required': false
}

export default masterPreferences
