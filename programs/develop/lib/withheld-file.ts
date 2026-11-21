// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type WithheldKind = 'private' | 'outside'

// A file on disk the build will not bundle: saying it does not exist would
// send the author looking for a file that is right there.
export function withheldFileLines(
  file: string,
  kind: WithheldKind,
  options: {check?: string; holds?: string} = {}
): [string, string] {
  return [
    `${file} is not bundled.${options.check ? ` ${options.check}` : ''}`,
    kind === 'private'
      ? `The build never bundles env files, tooling files or repository files. Move the ${options.holds || 'code'} into a file with another name.`
      : 'The file is not one the project or its workspace shares. Move it into the project.'
  ]
}

export const WITHHELD_CSS_REF = 'CssWithheldRef'

interface WithheldCssRef {
  name: typeof WITHHELD_CSS_REF
  // The reference as the stylesheet writes it.
  ref: string
  // The stylesheet, from the manifest folder, with forward slashes.
  sheet: string
}

// Loaders are built apart from the plugins, so the list rides on the
// compilation they share, under a key both builds spell the same.
const NOTED = Symbol.for('extensionjs.withheldCssRefs')

type Noting = {[NOTED]?: WithheldCssRef[]}

// The bundler keeps only the fields it knows on a diagnostic, so what a
// later step reads by field is kept here, per compilation.
export function noteWithheldCssRef(
  compilation: object | null | undefined,
  ref: string,
  sheet: string
) {
  if (!compilation) return

  const noted = ((compilation as Noting)[NOTED] ||= [])

  if (!noted.some((other) => other.ref === ref && other.sheet === sheet)) {
    noted.push({name: WITHHELD_CSS_REF, ref, sheet})
  }
}

export function withheldCssRefs(
  compilation: object | null | undefined
): readonly WithheldCssRef[] {
  return (compilation as Noting | null | undefined)?.[NOTED] || []
}
