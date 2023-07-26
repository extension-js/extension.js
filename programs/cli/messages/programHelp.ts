//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

export default function programHelp() {
  return `
# Help center for the extension-create program

## Usage: \`extension-create [command] [options]\`

**Note:** If you are looking for a specific list of options,
all high-level commands offer their own \`--help\` file with
information about usage and a list of command flags available.

For example:

\`extension-create create --help\`
outputs information about the \`create\` command.

## Options available

\`extension-create create <extension-name>\`
Creates a new extension from template. The "create" command
is optional and can be ommitted.

\`extension-create dev <extension-path>\`
Starts a new browser instance in development mode, with the target
extension loaded and auto-reloaded based on file changes.

\`extension-create start <extension-path>\`
Starts a new browser instance in production mode, with the target
extension compiled based on the browser choice.

\`extension-create build <extension-path>\`
Builds the target extension with browser defaults, ready for packaging.

\`extension-create --help\`
This command ;) Outputs a help file with key command options.

Feels something is wrong? Help by reporting a bug:
https://github.com/cezaraugusto/extension-create/issues/new
`
}
