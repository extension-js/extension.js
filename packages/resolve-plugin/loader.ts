import path from 'path'
import {type LoaderContext} from 'webpack'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import * as parser from '@babel/parser'

import utils from './helpers/utils'
import transformSource from './steps/transformSource'
import {type IncludeList} from './types'
import emitResolverModule from './steps/emitResolverModule'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    includeList: {
      type: 'object'
    },
    exclude: {
      type: 'array'
    }
  }
}

interface ResolvePluginContext extends LoaderContext<any> {
  getOptions: () => {
    test: string
    manifestPath: string
    includeList: IncludeList
    exclude: string[]
  }
}

export default function (this: ResolvePluginContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Resolve Loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const resolverName = 'resolver-module.js'

    // Skip if path is node_modules
    if (
      this.resourcePath.includes('node_modules') ||
      this.resourcePath.includes('dist/')
    ) {
      return source
    }

    const plugins: any[] = ['jsx']

    if (utils.isUsingTypeScript(this.rootContext)) {
      plugins.push('typescript')
    }

    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins
    })

    // 1 - Emit the resolver module. This will be used by the
    // browser extension to resolve the API methods.
    const resolverAbsolutePath = path.join(__dirname, resolverName)
    emitResolverModule(this, resolverAbsolutePath)

    // 2 - Get the current source, add the resolver module import and
    // transform the API methods to use the resolver module.
    return transformSource(ast, source)
  }

  return source
}
