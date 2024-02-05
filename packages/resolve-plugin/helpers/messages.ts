const notFoundError = `Could not resolve file path. Ensure the file exists in the "public" or "pages" directory.`

function resolverHtmlError(filePath?: string) {
  console.error(
    `Could not resolve path ${filePath}. Either add it to the "public" directory or create a page in the "pages" directory.`
  )
  return filePath
}

function resolverJsError(filePath?: string) {
  return `Could not resolve path ${filePath}. Either add it to the "public" directory or create a script in the "scripts" directory.`
}

function resolverStaticError(filePath?: string) {
  return `Could not resolve path ${filePath}. If you want to preserve this file path, add the file to the "public" directory.`
}

export default {
  notFoundError,
  resolverHtmlError,
  resolverJsError,
  resolverStaticError
}
