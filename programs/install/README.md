# extension-install

Managed browser installer/uninstaller runtime for Extension.js CLI.

This package powers:

- `extension install <browser>`
- `extension install --browser <browser[,browser2]|all>`
- `extension install --where`
- `extension uninstall <browser>`
- `extension uninstall --all`
- `extension uninstall --where`

For a single browser, the positional form is the canonical command. Use `--browser` when you want multiple targets, browser families, or `all`.

When `--where` is used together with a browser name, `--browser`, or `--all` on uninstall, Extension.js prints the resolved managed install path(s) for those target browsers. Without a target, it prints the managed cache root.

Uninstall scope is limited to the Extension.js managed cache root (or `EXT_BROWSERS_CACHE_DIR` when set). It does not remove browser installations outside that managed location.

Linux note for `edge`: Playwright channel installs may require a privileged interactive session (`sudo` prompt). If channel install cannot proceed but a system Edge binary is already present, Extension.js will use that existing binary. Otherwise, install Edge system-wide first and then run `extension install edge` (or use `chromium`).

Default managed cache locations are stable and human-readable:
- macOS: `~/Library/Caches/extension.js/browsers`
- Linux: `~/.cache/extension.js/browsers` (or `$XDG_CACHE_HOME/extension.js/browsers`)
- Windows: `%LOCALAPPDATA%\\extension.js\\browsers`

Custom path override example:
- `EXT_BROWSERS_CACHE_DIR=/tmp/extension.js/browsers-dev`
