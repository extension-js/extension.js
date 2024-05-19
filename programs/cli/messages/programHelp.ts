//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

export default function programHelp() {
  return `
# Help center for the 🧩 Extension.js program

## Usage: \`extension [command] [options]\`

**Note:** If you are looking for a specific list of options,
all high-level commands offer their own \`--help\` file with
information about usage and a list of command flags available.

For example:

\`extension create --help\`
outputs information about the \`create\` command.

## Options available

\`extension create <extension-name>\`
Creates a new extension from template. The "create" command
is optional and can be ommitted.

\`extension dev <extension-path>\`
Starts a new browser instance in development mode, with the target
extension loaded and auto-reloaded based on file changes.

\`extension start <extension-path>\`
Starts a new browser instance in production mode, with the target
extension compiled based on the browser choice.

\`extension build <extension-path>\`
Builds the target extension with browser defaults, ready for packaging.

\`extension --help\`
This command ;) Outputs a help file with key command options.

Feels something is wrong? Help by reporting a bug:
https://github.com/cezaraugusto/extension/issues/new
`
}
