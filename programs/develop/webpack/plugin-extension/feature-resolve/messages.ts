import colors from 'pintor'

export function resolveAttachSummary(
  browser: string,
  manifestDir: string,
  mode: string
) {
  return `Resolve attach — browser=${colors.yellow(browser)}, dir=${colors.underline(manifestDir)}, mode=${colors.gray(
    mode
  )}`
}

export function resolveFileSkip(
  reason: 'public' | 'no-patterns',
  file: string
) {
  return `Resolve skip — ${reason} for ${colors.underline(file)}`
}

export function resolveSwcLoad(kind: 'esm' | 'cjs' | 'unavailable') {
  return `Resolve SWC load — ${colors.gray(kind)}`
}

export function resolveFileTransformSummary(args: {
  file: string
  textEdited: boolean
  astEdited: boolean
  apiLiterals: number
  warningsEmitted: number
  sourceMap: boolean
}) {
  const {file, textEdited, astEdited, apiLiterals, warningsEmitted, sourceMap} =
    args
  return (
    `Resolve transformed ${colors.underline(file)} — ` +
    `textEdited=${colors.gray(String(textEdited))}, ` +
    `astEdited=${colors.gray(String(astEdited))}, ` +
    `apiLiterals=${colors.gray(String(apiLiterals))}, ` +
    `warnings=${colors.gray(String(warningsEmitted))}, ` +
    `sourcemap=${colors.gray(String(sourceMap))}`
  )
}
