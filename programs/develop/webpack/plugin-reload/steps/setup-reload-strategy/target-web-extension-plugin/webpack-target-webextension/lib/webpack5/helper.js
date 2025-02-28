/**
 * @param {import('webpack').Compilation} compilation
 * @param {typeof import('webpack').Template} Template
 * @returns {{f: (args: string, body: string | string[]) => string, retF: (returnValue: string, args?: string) => string}}
 */
module.exports.TemplateFn = (compilation, Template) => {
  return {
    f: (args, body) => {
      if (!compilation) throw new TypeError('No compilation is found.')
      if (compilation.runtimeTemplate) return compilation.runtimeTemplate.basicFunction(args, body)

      // rspack
      return compilation.outputOptions.environment.arrowFunction
        ? `(${args}) => {\n${Template.indent(body)}\n}`
        : `function(${args}) {\n${Template.indent(body)}\n}`
    },
    retF: (returnValue, args = '') => {
      if (!compilation) throw new TypeError('No compilation is found.')
      if (compilation.runtimeTemplate) return compilation.runtimeTemplate.returningFunction(returnValue, args)

      // rspack
      return compilation.outputOptions.environment.arrowFunction
        ? `(${args}) => (${returnValue})`
        : `function(${args}) { return ${returnValue}; }`
    },
  }
}
