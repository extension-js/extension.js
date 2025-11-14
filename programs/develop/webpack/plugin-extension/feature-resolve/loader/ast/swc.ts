import {createRequire} from 'module'

let swcRuntimeModule: any

export async function loadSwc() {
  if (swcRuntimeModule) return swcRuntimeModule

  try {
    const mod: any = await import('@swc/core')
    swcRuntimeModule = mod?.default && mod.default.parse ? mod.default : mod
  } catch {
    try {
      const mod: any =
        (typeof require === 'function' && require('@swc/core')) ||
        createRequire(
          typeof __filename !== 'undefined' ? __filename : import.meta.url
        )('@swc/core')
      swcRuntimeModule = mod?.default && mod.default.parse ? mod.default : mod
    } catch {
      // best-effort only
    }
  }
  return swcRuntimeModule || null
}

export async function parseWithSwc(
  swc: any,
  source: string,
  flags: {isTS: boolean; isJSX: boolean}
) {
  return swc.parse(source, {
    syntax: flags.isTS ? 'typescript' : 'ecmascript',
    tsx: flags.isTS && flags.isJSX,
    jsx: !flags.isTS && flags.isJSX,
    target: 'es2022',
    isModule: true
  })
}
