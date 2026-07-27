// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {prefix} from '../../lib/messaging'

export function assetsRulesEnabled(rules: string[]) {
  const kinds = rules.length > 0 ? rules.join(',').toLowerCase() : 'none'
  return `${prefix('debug')} assets   rules=${rules.length} kinds=${kinds}`
}

export function assetsConfigsDetected(
  filenamePattern: string,
  svgRuleMode: 'default' | 'custom',
  svgInlineLimitKB?: number,
  imageInlineLimitKB?: number,
  fileInlineLimitKB?: number
) {
  const kb = (v?: number) => (v || v === 0 ? `${v}KB` : 'none')
  return (
    `${prefix('debug')} assets   config pattern=${filenamePattern} ` +
    `svgRule=${svgRuleMode} svgInline=${kb(svgInlineLimitKB)} ` +
    `imageInline=${kb(imageInlineLimitKB)} fileInline=${kb(fileInlineLimitKB)}`
  )
}

export function assetsEmittedSummary(
  total: number,
  byCategory: {svg: number; images: number; fonts: number; files: number}
) {
  return (
    `${prefix('debug')} assets   emitted=${total} svg=${byCategory.svg} ` +
    `images=${byCategory.images} fonts=${byCategory.fonts} ` +
    `files=${byCategory.files}`
  )
}
