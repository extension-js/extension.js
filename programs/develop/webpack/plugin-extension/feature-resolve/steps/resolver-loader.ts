import path from 'path'
import {validate} from 'schema-utils'
import {Schema} from 'schema-utils/declarations/validate'
import {transformSource} from './transform-source'
import {emitResolverModule} from './emit-resolver-module'
import {ResolvePluginContext} from './loader-types'
import {type Manifest} from '../../../../types'

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

function getContentScripts(manifest: Manifest, manifestDir: string): string[] {
  if (!manifest.content_scripts) {
    return []
  }

  const scripts: string[] = []

  manifest.content_scripts.forEach((contentScript) => {
    if (contentScript.js) {
      contentScript.js.forEach((script) => {
        // Resolve each script path relative to the manifest directory
        scripts.push(path.resolve(manifestDir, script))
      })
    }
  })

  return scripts
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
    const resolverName = 'resolver-module.mjs'

    if (
      this.resourcePath.includes('node_modules') ||
      this.resourcePath.includes('dist/')
    ) {
      return source
    }

    // Get the directory of the manifest file
    const manifestDir = path.dirname(options.manifestPath)
    // Get the content scripts, resolved relative to the manifest directory
    const contentScripts = getContentScripts(
      require(options.manifestPath) as Manifest,
      manifestDir
    )

    if (contentScripts.some((script) => script === this.resourcePath)) {
      return source
    }

    const transformedSource = transformSource(source, options)
    const resolverAbsolutePath = path.join(__dirname, resolverName)

    emitResolverModule(this, resolverAbsolutePath)

    return transformedSource
  }

  return source
}
