import path from 'path'
import fs from 'fs'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import * as parser from '@babel/parser'

import emitResolverModule from './src/steps/emitResolverModule'
import addImportDeclaration from './src/steps/addImportDeclaration'
import transformSource from './src/steps/transformSource'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    }
  }
}

export interface BrowserExtensionContext extends LoaderContext<any> {
  getOptions: () => {
    test: string
  }
}

let emitted = false

export default function (this: BrowserExtensionContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    const outputPath = this?._compilation?.options.output.path || ''
    const resolverName = 'resolver-module.js'

    console.log('resolver moduleMMMM exists', resolverName)
    // 1 - Emit the resolver module. This will be used by the
    // browser extension to resolve the API methods.
    // The resolver is bundled by this loader at install time.
    emitResolverModule(this, resolverName)

    // 2 - Add the import declaration to the resolver module
    // to every JS file that uses the API methods.
    addImportDeclaration(ast, resolverName, this)

    // 2 - Add the import declaration to the source code
    // and transform the arguments of the API methods
    // to use the calls from the resolver module.
    // This way, the browser extension will be able to
    // resolve the API methods at runtime.
    return transformSource(ast, source, resolverName)
    // return source
  }

  return source
}
