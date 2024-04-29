//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

export function unsupportedNodeVersion() {
  return `
    You are using an unsupported Node version (${process.version}).

    Please update to a version higher than 18.
  `
}

export function noURLWithoutStart(argument: string) {
  return `
    The default \`create\` command does not accept URLs.
    Are you forgetting a \`start\` command? Maybe:

    npx extension \`start\` ${argument}
  `
}

export function notImplemented(argument: string) {
  return `${argument} command not implemented yet.`
}
