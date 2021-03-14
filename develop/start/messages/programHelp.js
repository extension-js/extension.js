// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const {log} = require('log-md')

module.exports = function () {
  log(`
    # Help center for the \`start\` command

    ## The \`--remote\` _<github-url>_ flag

    If you want to get up and running with an existing extension
    available remotely on GitHub, you can specify its path as an
    argument to the \`--remote\` flag.

    The path can be any GitHub URL subdirectory. If a GitHub URL is provided,
    the directory is downloaded to the current working directory.

    For example:

    \`extension-create start --remote https://github.com/user/repo/\`
    will download \`repo\` in the current working directory and
    kick off a new browser instance with \`repo\` loaded as an extension.

    Works with subdirectories as well, like https://github.com/user/repo/subdirs

    ## The \`--manifest\` _<github-url>_ flag

    You can specify a custom path to your manifest file. By default
    \`extension-create\` will look for your project's root
    path and **public/** directory, failing if no manifest is found.

    ## The \`--browser\` _<browser-vendor>_ flag

    A browser vendor name can be provided to run your extension on a specific browser.
    One of:

    - \`--browser\`=chrome (default)
    - \`--browser\`=edge
    - \`--browser\`=all (runs all available browsers)

    Feels something is wrong? Help by reporting a bug:
    https://github.com/cezaraugusto/extension-create/issues/new
  `)
}
