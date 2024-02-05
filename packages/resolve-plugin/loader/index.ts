import fs from 'fs'
import path from 'path'
import {type LoaderContext} from 'webpack'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import * as parser from '@babel/parser'

import transformSource from './transformSource'
import {IncludeList} from '../types'
import getManifestEntries from './getManifestEntries'

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

const emitResolverModule = (loader: any, resolverName: string) => {
  // The file below is resolver-module after TS compilation.
  // We read this file and emit to user's output directory.
  const source = fs.readFileSync(
    path.resolve(__dirname, '../resolver-module.js'),
    'utf-8'
  )
  loader.emitFile(resolverName, source)
}

function parseIncludeList(
  manifestPath: string,
  includeList: IncludeList
): IncludeList {
  const manifestDir = path.dirname(manifestPath)

  const updatedIncludeList: IncludeList = Object.entries(includeList).reduce(
    (acc, [key, absolutePath]) => {
      const relativePath = path.relative(manifestDir, absolutePath)
      acc[key] = relativePath
      return acc
    },
    {} as IncludeList
  )

  return updatedIncludeList
}

function parseManifestList(manifestPath: string) {
  const manifest = require(manifestPath)
  const manifestIncludeList = getManifestEntries(manifest)
  return manifestIncludeList
}

export default function (this: ResolvePluginContext, source: string) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'Browser Extension Resolve Loader',
    baseDataPath: 'options'
  })

  console.log('signal 1 ----------------------')
  if (new RegExp(options.test).test(this.resourcePath)) {
    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    const resolverName = 'resolver-module.js'
    const includeList = this.getOptions().includeList
    const include = parseIncludeList(options.manifestPath, includeList)
    const manifestInclude = parseManifestList(options.manifestPath)
    const filesList = {...include, ...manifestInclude}

    console.log('signal 2 ----------------------')
    console.log({filesList})

    // 1 - Emit the resolver module. This will be used by the
    // browser extension to resolve the API methods.
    // The resolver is bundled by this loader at install time.
    // emitResolverModule(this, resolverName)

    // 3 - Add the import declaration to the resolver module
    // to every JS file that uses the API methods.
    // addImportDeclaration(ast, this, resolverName)
    // const reloadCode = `;import r from 'resolver-modules';\n`

    // 4 - Transform the arguments of the API methods
    // to use the calls from the resolver module.
    // This way, the browser extension will be able to
    // resolve the API methods at runtime.
    // return transformSource(ast, `${reloadCode}${source}`)
    return transformSource(ast, source)
  }

  return source
}
