// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compiler, Compilation} from '@rspack/core'

export function pushCompilationError(
  compiler: Compiler,
  compilation: Compilation,
  name: string,
  message: string,
  file?: string
): void {
  // Unit tests may pass a mocked compiler without `rspack`.
  const ErrorConstructor = (compiler as any)?.rspack?.WebpackError || Error
  const error = new ErrorConstructor(message) as Error & {file?: string}
  error.name = name

  if (file) error.file = file

  if (!compilation.errors) {
    compilation.errors = []
  }

  compilation.errors.push(error)
}
