export function mergeShadowIntoDocument(
  mainHTML: string,
  shadowContent: string
): string {
  try {
    if (!mainHTML) return ''
    const hasRoot = /<div id=(["'])extension-root\1/i.test(mainHTML)
    if (hasRoot) {
      const emptyRoot = /<div id=(["'])extension-root\1[^>]*><\/div>/i
      const replacedEmpty = mainHTML.replace(
        emptyRoot,
        `<div id="extension-root">${shadowContent}</div>`
      )
      if (replacedEmpty !== mainHTML) return replacedEmpty
      return mainHTML.replace(
        /<div id=(["'])extension-root\1[^>]*>[\s\S]*?<\/div>/i,
        `<div id="extension-root">${shadowContent}</div>`
      )
    }
    if (/<\/body>/i.test(mainHTML)) {
      return mainHTML.replace(
        /<\/body>/i,
        `<div id="extension-root">${shadowContent}</div></body>`
      )
    }
    return `${mainHTML}\n<div id="extension-root">${shadowContent}</div>`
  } catch {
    return mainHTML
  }
}
