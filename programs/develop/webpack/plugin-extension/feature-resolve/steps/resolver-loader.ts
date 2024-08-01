import path from 'path'
import {validate} from 'schema-utils'
import {Schema} from 'schema-utils/declarations/validate'
import {transformSource} from './transform-source'
import {emitResolverModule} from './emit-resolver-module'
import {ResolvePluginContext} from './loader-types'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {type: 'string'},
    manifestPath: {type: 'string'},
    includeList: {type: 'object'},
    excludeList: {type: 'object'},
    loaderOptions: {type: 'object'}
  }
}

export default function resolveLoader(
  this: ResolvePluginContext,
  source: string
) {
  const options = this.getOptions()

  validate(schema, options, {
    name: 'resolve:loader',
    baseDataPath: 'options'
  })

  if (new RegExp(options.test).test(this.resourcePath)) {
    const resolverName = 'resolver-module.js'

    if (
      this.resourcePath.includes('node_modules') ||
      this.resourcePath.includes('dist/')
    ) {
      return source
    }

    const transformedSource = transformSource(source, options)

    const resolverAbsolutePath = path.join(__dirname, resolverName)
    emitResolverModule(this, resolverAbsolutePath)

    return transformedSource
  }

  return source
}
