import template from '@babel/template'

interface ParseResult {
  path: string
}

export function handlePathProperty(obj: any) {
  // Custom logic for objects with 'path'
  return obj
}

export function handlePopupProperty(obj: any) {
  // Custom logic for objects with 'popup'
  return obj
}

export function handeFilesProperty(obj: any) {
  // Custom logic for objects with 'files'
  return obj
}

export function handleUrlProperty(path: any) {
  path.node.arguments.forEach((arg: any, index: number) => {
    const wrapTemplate = template.expression(
      // `r.handleUrl(%%arg%%)`,
      `r.handleUrl(%%arg%%)`,
      {preserveComments: true}
    )
    path.node.arguments[index] = wrapTemplate({arg})
  })
}

export function handleStringProperty(url: any) {
  // Custom logic for string URLs
  return url
}
