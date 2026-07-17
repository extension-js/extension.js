import type {Compilation} from 'webpack'

export type TemplateLike = {
  asString: (chunks: any) => string
  indent: (lines: any) => string
}

/**
 * @param compilation webpack/rspack compilation
 * @param Template webpack Template
 */
export function TemplateFn(compilation: any, Template: TemplateLike) {
  return {
    f: (args: string, body: string | string[]) => {
      if (!compilation) throw new TypeError('No compilation is found.')
      if (compilation.runtimeTemplate)
        return compilation.runtimeTemplate.basicFunction(args, body)

      // rspack
      return compilation.outputOptions.environment.arrowFunction
        ? `(${args}) => {\n${Template.indent(body)}\n}`
        : `function(${args}) {\n${Template.indent(body)}\n}`
    },
    retF: (returnValue: string, args = '') => {
      if (!compilation) throw new TypeError('No compilation is found.')
      if (compilation.runtimeTemplate)
        return compilation.runtimeTemplate.returningFunction(returnValue, args)

      // rspack
      return compilation.outputOptions.environment.arrowFunction
        ? `(${args}) => (${returnValue})`
        : `function(${args}) { return ${returnValue}; }`
    }
  }
}
