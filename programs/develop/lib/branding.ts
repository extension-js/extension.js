// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

export function scrubBrand(txt: string, brand = 'Extension.js'): string {
  if (!txt) return txt
  const safeBrand = brand.replace(/\$/g, '$$$$')
  const preserved: string[] = []
  const preserve = (value: string) => {
    const token = `__EXT_BRAND_PRESERVE_${preserved.length}__`
    preserved.push(value)
    return token
  }

  let output = txt
    // Keep upstream optimization warnings pointing to the actual bundler/docs.
    .replace(/\bRspack\b(?=\s+performance recommendations:)/gi, preserve)
    .replace(/https?:\/\/rspack\.(?:rs|dev)\/[^\s)]+/gi, preserve)
    .replace(/(?<!@)\bRspack\b/gi, safeBrand)
    .replace(/(?<!@)\bWebpack\b/gi, safeBrand)
    .replace(/(?<!@)\bwebpack-dev-server\b/gi, `${safeBrand} dev server`)
    .replace(/(?<!@)\bRspackDevServer\b/gi, `${safeBrand} dev server`)
    .replace(/ModuleBuildError:\s*/g, '')
    .replace(/ModuleParseError:\s*/g, '')
    .replace(/Error:\s*Module\s+build\s+failed.*?\n/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n{2}(?=WARNING in )/g, '\n')

  preserved.forEach((value, index) => {
    output = output.replace(`__EXT_BRAND_PRESERVE_${index}__`, value)
  })

  return output
}

export function makeSanitizedConsole(brand = 'Extension.js') {
  const sanitize = (a: unknown) =>
    typeof a === 'string' ? scrubBrand(a, brand) : a

  return {
    log: (...args: any[]) => console.log(...args.map(sanitize)),
    info: (...args: any[]) => console.info(...args.map(sanitize)),
    warn: (...args: any[]) => console.warn(...args.map(sanitize)),
    error: (...args: any[]) => console.error(...args.map(sanitize))
  }
}
