// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

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

    // Fallback: if a data-extension-root host exists, inject the merged content
    // right after its opening tag to approximate the shadow content in the output.
    const hostOpen = /(<[^>]*data-extension-root=(["'])true\2[^>]*>)/i
    if (hostOpen.test(mainHTML)) {
      return mainHTML.replace(
        hostOpen,
        `$1<div id="extension-root">${shadowContent}</div>`
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
