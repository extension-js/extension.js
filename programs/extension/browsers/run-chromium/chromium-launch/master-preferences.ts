// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

const masterPreferences = {
  alternate_error_pages: {
    enabled: false
  },
  autofill: {
    enabled: false
  },
  browser: {
    check_default_browser: false,

    // Policy setting whether default browser check should be disabled and default
    // browser registration should take place.
    default_browser_setting_enabled: false
  },
  // "install" enables default apps, "noinstall" disables; copied into the
  // profile on first run, applied only when creating a new profile.
  default_apps: 'noinstall',
  distribution: {
    alternate_shortcut_text: false,

    auto_launch_chrome: false,

    import_bookmarks: false,

    import_history: false,

    import_home_page: false,

    import_search_engine: false,

    suppress_first_run_bubble: true,

    do_not_register_for_update_launch: true,

    make_chrome_default: false,

    make_chrome_default_for_user: false,

    require_eula: false,

    // Suppress the first-run 'set-as-default' dialog (Windows 8+ context only).
    suppress_first_run_default_browser_prompt: true
  },
  dns_prefetching: {
    enabled: false
  },
  download: {
    default_directory: '/tmp/',

    directory_upgrade: true,

    open_pdf_in_adobe_reader: false,

    prompt_for_download: true
  },
  enable_do_not_track: true,
  extensions: {
    theme: {
      use_system: false
    },
    toolbarsize: -1,
    developer_mode: true,
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
    enabled: false,

    safebrowsingextended_reporting_enabled: false
  },
  savefile: {
    default_directory: '/tmp',

    type: 0
  },
  search: {
    suggest_enabled: false
  },

  session: {
    // Startup pref: 1 = restore last session, 4 = restore kURLsToRestoreOnStartup,
    // 5 = open the New Tab Page; other values deprecated/unused.
    restore_on_startup: 5
  },
  sync: {
    suppress_start: true
  },
  sync_promo: {
    show_on_first_run_allowed: false,

    show_ntp_bubble: false
  },
  translate: {
    enabled: false
  }
}

const chromeMasterPreferences = {
  ...masterPreferences
}

const edgeMasterPreferences = {
  ...masterPreferences
}

// Chromium's own first-run suppression above is not enough for a fork that
// gates its onboarding behind its own preference names, the same way Zen
// and Floorp do on the gecko side. Each entry is the fork's own keys, seeded
// into a fresh profile so the first thing on screen is the extension.
const forkPreferences: Record<string, Record<string, unknown>> = {
  vivaldi: {
    vivaldi: {
      startup: {
        // Without it every fresh profile opens the account-signup wizard
        // (vivaldi:welcome, a chrome-extension:// page of Vivaldi's own UI)
        // over the extension.
        has_seen_welcome_page: true
      }
    }
  }
}

export function getForkPreferences(browser?: string): Record<string, unknown> {
  return forkPreferences[String(browser || '')] || {}
}

export {chromeMasterPreferences, edgeMasterPreferences}
