// PROFILE PREFS aka "Master Preferences" aka "User Preferences"
// * Official ref: https://www.chromium.org/administrators/configuring-other-preferences/
// * Official Source code: https://src.chromium.org/viewvc/chrome/trunk/src/chrome/common/pref_names.cc?view=markup
// * Extra ref (where this source code is adapted): https://serverfault.com/a/635203
const masterPreferences = {
  alternate_error_pages: {
    enabled: false
  },
  autofill: {
    enabled: false
  },
  browser: {
    // Boolean that indicates whether we should check if we are the default browser
    // on start-up.
    check_default_browser: false,

    // Policy setting whether default browser check should be disabled and default
    // browser registration should take place.
    default_browser_setting_enabled: false
  },
  // A string property indicating whether default apps should be installed
  // in this profile.  Use the value "install" to enable defaults apps, or
  // "noinstall" to disable them.  This property is usually set in the
  // master_preferences and copied into the profile preferences on first run.
  // Defaults apps are installed only when creating a new profile.
  default_apps: 'install',
  distribution: {
    // Boolean. Use alternate text for the shortcut. Cmd line override present.
    alternate_shortcut_text: false,

    // Boolean. Whether to instruct the installer to auto-launch chrome on computer
    // startup. The default (if not provided) is |false|.
    auto_launch_chrome: false,

    // Boolean pref that disables all logging.
    //  disable_logging: true,

    // Boolean pref that triggers silent import of the default browser bookmarks.
    import_bookmarks: false,

    // Boolean pref that triggers silent import of the default browser history.
    import_history: false,

    // Boolean pref that triggers silent import of the default browser homepage.
    import_home_page: false,

    // Boolean pref that triggers silent import of the default search engine.
    import_search_engine: false,

    // Boolean. Do not show first run bubble, even if it would otherwise be shown.
    suppress_first_run_bubble: true,

    // Boolean. Do not launch Chrome after first install. Cmd line override present.
    // "do_not_launch_chrome": true,

    // Boolean. Do not register with Google Update to have Chrome launched after
    // install. Cmd line override present.
    do_not_register_for_update_launch: true,

    // Boolean. Register Chrome as default browser. Cmd line override present.
    make_chrome_default: false,

    // Boolean. Register Chrome as default browser for the current user.
    make_chrome_default_for_user: false,

    // Boolean. Expect to be run by an MSI installer. Cmd line override present.
    //  msi: true,

    // Boolean. Show EULA dialog before install.
    require_eula: false,

    // Boolean. Indicates that the first-run 'set-as-default' dialog should not be
    // shown. Relevant in Windows 8+ context only. If this is true, the standard
    // 'set default browser' prompt on the butter-bar will appear during the first
    // run.
    suppress_first_run_default_browser_prompt: true
  },
  dns_prefetching: {
    enabled: false
  },
  download: {
    // The default directory to save downloaded files to. This is only used if
    // the user does not select a directory for a download. It is recommended
    // that you use this in conjunction with "prompt_for_download" to ensure
    // that users are always prompted for a download location.
    default_directory: '/tmp/',

    // Whether to prompt for download location for each file download.
    directory_upgrade: true,

    // Whether downloaded PDFs should be opened in Adobe Acrobat Reader.
    open_pdf_in_adobe_reader: false,

    // Whether to prompt for download location for each file download.
    prompt_for_download: true
  },
  enable_do_not_track: true,
  extensions: {
    theme: {
      use_system: false
    },
    toolbarsize: -1,
    ui: {
      developer_mode: true
    }
  },
  plugins: {
    plugins_list: [
      {
        enabled: false,
        name: 'Java(TM)'
      }
    ],
    show_details: true
  },
  profile: {
    password_manager_enabled: false
  },
  safebrowsing: {
    // Boolean that is true when SafeBrowsing is enabled.
    enabled: false,

    // Boolean that tell us whether malicious download feedback is enabled.
    safebrowsingextended_reporting_enabled: false
  },
  savefile: {
    default_directory: '/tmp',

    // Whether to prompt for download location for each file download.
    type: 0
  },
  search: {
    // Boolean that is true when Suggest support is enabled.
    suggest_enabled: false
  },

  session: {
    // An integer pref. Holds one of several values:
    // 0: (deprecated) open the homepage on startup.
    // 1: restore the last session.
    // 2: this was used to indicate a specific session should be restored. It is
    //    no longer used, but saved to avoid conflict with old preferences.
    // 3: unused, previously indicated the user wants to restore a saved session.
    // 4: restore the URLs defined in kURLsToRestoreOnStartup.
    // 5: open the New Tab Page on startup.
    restore_on_startup: 1
  },
  sync: {
    suppress_start: true
  },
  sync_promo: {
    // Boolean that specifies if the sign in promo is allowed to show on first run.
    // This preference is specified in the master preference file to suppress the
    // sign in promo for some installations.
    show_on_first_run_allowed: false,

    // Boolean that specifies if we should show a bubble in the new tab page.
    // The bubble is used to confirm that the user is signed into sync.
    show_ntp_bubble: false
  },
  translate: {
    enabled: false
  }
}

export default masterPreferences
