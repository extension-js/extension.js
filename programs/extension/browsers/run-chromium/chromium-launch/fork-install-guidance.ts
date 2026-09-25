// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {getInstallGuidance as getBraveInstallGuidance} from 'brave-location'
import {getInstallGuidance as getOperaInstallGuidance} from 'opera-location2'
import {getInstallGuidance as getVivaldiInstallGuidance} from 'vivaldi-location2'
import {getInstallGuidance as getYandexInstallGuidance} from 'yandex-location'

// A system-located Chromium fork is never downloaded into the managed cache,
// so its remedy is the fork's own install steps, read off its locator.
export function chromiumForkInstallGuidance(browser: unknown): string | null {
  const read = (fn: () => string) => {
    try {
      return fn()
    } catch {
      return ''
    }
  }

  switch (browser) {
    case 'brave':
      return read(() => getBraveInstallGuidance())
    case 'opera':
      return read(() => getOperaInstallGuidance())
    case 'vivaldi':
      return read(() => getVivaldiInstallGuidance())
    case 'yandex':
      return read(() => getYandexInstallGuidance())
    default:
      return null
  }
}
