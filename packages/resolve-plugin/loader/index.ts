import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import * as parser from '@babel/parser'

import transformSource from './transformSource'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    }
  }
}

export default function (this: any, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Resolve Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    // const resolverName = 'browser-extension-module-resolver.js'

    // 1 - Emit the resolver module. This will be used by the
    // browser extension to resolve the API methods.
    // The resolver is bundled by this loader at install time.
    // emitResolverModule(this, resolverName)

    // 2 - Add the import declaration to the resolver module
    // to every JS file that uses the API methods.
    // addImportDeclaration(ast, this, resolverName)
    // const reloadCode = `;import r from 'resolver-modules';\n`

    // 3 - Transform the arguments of the API methods
    // to use the calls from the resolver module.
    // This way, the browser extension will be able to
    // resolve the API methods at runtime.
    // return transformSource(ast, `${reloadCode}${source}`)
    return transformSource(ast, source)
  }

  return source
}
