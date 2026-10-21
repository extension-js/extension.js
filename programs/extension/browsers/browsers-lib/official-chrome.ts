// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isWslEnv} from './wsl-support'

export function looksOfficialChromeBinaryPath(bin: string): boolean {
  const p = String(bin || '')
  if (!p) return false

  if (
    /\/Applications\/Google Chrome(?: (?:Beta|Dev|Canary))?\.app\/Contents\/MacOS\/Google Chrome/i.test(
      p
    )
  ) {
    return true
  }

  if (/\\Google\\Chrome\\Application\\chrome\.exe$/i.test(p)) return true
  if (/\/opt\/google\/chrome\//i.test(p)) return true
  if (/\/google-chrome(?:-stable)?$/i.test(p)) return true

  return false
}

export function isRefusedOfficialChrome(bin: string): boolean {
  return looksOfficialChromeBinaryPath(bin) && !isWslEnv()
}
