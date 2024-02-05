export function manifestNotFound() {
  console.log(`
# Error! Can't find the project's manifest file.

Check your extension \`manifest.json\` file and ensure its path points to
one of the options above, and try again.
  `)
}
