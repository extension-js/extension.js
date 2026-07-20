// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Profile prefs ("Master Preferences"): sourced from mozilla's all.js /
// firefox.js defaults and web-ext's preferences.js.

const masterPreferences = {
  // Suppress first-run and default-browser prompts to avoid stealing focus
  'browser.aboutwelcome.enabled': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.shell.didSkipDefaultBrowserCheckOnFirstRun': true,
  'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
  'browser.startup.upgradeDialog.enabled': false,
  // Reduce “what’s new”/CFR prompts that can surface on fresh profiles
  'browser.messaging-system.whatsNewPanel.enabled': false,
  'browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons': false,
  'browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features': false,
  // Extra belt-and-suspenders to avoid override pages
  'browser.startup.homepage_override_url': '',
  'app.update.enabled': false,
  // Allow debug output via dump to be printed to the system console
  'browser.dom.window.dump.enabled': true,
  'browser.formfill.enable': false,
  // handle links targeting new windows
  // 1=current window/tab, 2=new window, 3=new tab in most recent window
  'browser.link.open_newwindow': 3,
  // Disable session restore, which can interfere
  // with extension development by restoring previous state
  'browser.sessionstore.enabled': false,
  // Suppress crash restore prompts after forced shutdowns
  'browser.sessionstore.resume_from_crash': false,
  'browser.sessionstore.max_resumed_crashes': 0,
  'browser.sessionstore.restore_on_demand': false,
  'browser.sessionstore.resume_session_once': false,
  // Avoid automatic safe-mode prompts after startup crashes
  'toolkit.startup.max_resumed_crashes': -1,
  'browser.shell.checkDefaultBrowser': false,
  'browser.sync.enabled': false,
  // browser.startup.page: 0 = blank, 1 = home, 2 = last visited,
  // 3 = resume previous session.
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
  'browser.newtabpage.enabled': false,
  'browser.newtabpage.activity-stream.showSearch': false,
  'browser.newtabpage.activity-stream.showSponsored': false,
  'browser.newtabpage.activity-stream.feeds.topsites': false,
  'browser.newtabpage.activity-stream.feeds.section.topstories': false,
  'browser.newtabpage.activity-stream.feeds.snippets': false,
  // Keep focus in the address bar on new tab
  'browser.newtabpage.activity-stream.improvesearch.handoffToAwesomebar': true,
  'datareporting.policy.dataSubmissionEnabled': false,
  // Set the policy firstURL to an empty string to prevent the privacy
  // info page to be opened on every run. See https://github.com/mozilla/web-ext/issues/1114
  'datareporting.policy.firstRunURL': '',
  'devtools.browserconsole.contentMessages': true,
  'devtools.chrome.enabled': true,
  // Don't show the Browser Toolbox prompt.
  'devtools.debugger.prompt-connection': false,
  'devtools.debugger.remote-enabled': true,
  'devtools.errorconsole.enabled': true,
  // Only load extensions from the application and user profile
  // (AddonManager SCOPE_PROFILE + SCOPE_APPLICATION).
  'extensions.installDistroAddons': false,
  // Disable add-ons not installed by the user in all scopes by default
  // (see the AddonManager SCOPE constants).
  'extensions.autoDisableScopes': 10,
  'extensions.chrome.enabled': true,
  'extensions.logging.enabled': false,
  'extensions.checkCompatibility.nightly': false,
  'extensions.update.enabled': false,
  'extensions.update.notifyUser': false,
  'extensions.enabledScopes': 5,
  'extensions.getAddons.cache.enabled': false,
  'network.prefetch.next': false,
  'network.speculative.preconnect.enabled': false,
  'toolkit.telemetry.enabled': false,
  'toolkit.telemetry.archive.enabled': false,
  'toolkit.telemetry.newProfilePing.enabled': false,
  'toolkit.recovery.enabled': false,
  // Make url-classifier updates so rare that they won't affect tests.
  // See http://hg.mozilla.org/mozilla-central/file/1dd81c324ac7/build/automation.py.in//l388
  'urlclassifier.updateinterval': 172800,
  // Ensure certifcate error pages don't show up
  'security.enterprise_roots.enabled': true,
  'xpinstall.signatures.required': false
}

export default masterPreferences

export function getPreferences(customPrefs: Record<string, unknown>) {
  return {
    ...masterPreferences,
    ...customPrefs
  }
}
