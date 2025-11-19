import colors from 'pintor'

export function assetsRulesEnabled(rules: string[]) {
  const list =
    rules.length > 0
      ? rules.map((n) => colors.yellow(n)).join(', ')
      : colors.gray('none')
  return `${colors.gray('►►►')} Assets: Rules enabled (${colors.gray(String(rules.length))}) ${list}`
}

export function assetsConfigsDetected(
  filenamePattern: string,
  svgRuleMode: 'default' | 'custom',
  svgInlineLimitKB?: number,
  imageInlineLimitKB?: number,
  fileInlineLimitKB?: number
) {
  const fmt = (v?: string | number) =>
    v || v === 0 ? colors.underline(String(v)) : colors.gray('n/a')
  return (
    `${colors.gray('►►►')} Assets: Configs\n` +
    `${colors.gray('FILENAME_PATTERN')} ${colors.underline(filenamePattern)}\n` +
    `${colors.gray('SVG_RULE')} ${colors.yellow(svgRuleMode)}\n` +
    `${colors.gray('SVG_INLINE_LIMIT')} ${fmt(svgInlineLimitKB)}${svgInlineLimitKB ? colors.gray('KB') : ''}\n` +
    `${colors.gray('IMAGE_INLINE_LIMIT')} ${fmt(imageInlineLimitKB)}${imageInlineLimitKB ? colors.gray('KB') : ''}\n` +
    `${colors.gray('FILE_INLINE_LIMIT')} ${fmt(fileInlineLimitKB)}${fileInlineLimitKB ? colors.gray('KB') : ''}`
  )
}

export function assetsEmittedSummary(
  total: number,
  byCategory: {svg: number; images: number; fonts: number; files: number}
) {
  return (
    `${colors.gray('►►►')} Assets: Emitted ${colors.gray(String(total))} file(s)\n` +
    `${colors.gray('SVG')} ${colors.underline(String(byCategory.svg))}\n` +
    `${colors.gray('IMAGES')} ${colors.underline(String(byCategory.images))}\n` +
    `${colors.gray('FONTS')} ${colors.underline(String(byCategory.fonts))}\n` +
    `${colors.gray('FILES')} ${colors.underline(String(byCategory.files))}`
  )
}
