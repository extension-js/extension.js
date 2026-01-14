// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

export function scrubBrand(txt: string, brand = 'Extension.js'): string {
  if (!txt) return txt
  return txt
    .replace(/\bRspack\b/gi, brand)
    .replace(/\bWebpack\b/gi, brand)
    .replace(/\bwebpack-dev-server\b/gi, `${brand} dev server`)
    .replace(/\bRspackDevServer\b/gi, `${brand} dev server`)
    .replace(/ModuleBuildError:\s*/g, '')
    .replace(/ModuleParseError:\s*/g, '')
    .replace(/Error:\s*Module\s+build\s+failed.*?\n/gi, '')
    .replace(/\n{3,}/g, '\n\n')
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
