import path from 'path'
import fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {isUsingReact} from '../helpers/isUsingReact'
import getAssetsFromHtml from '../lib/getAssetsFromHtml'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    exclude: {
      type: 'array'
    }
  }
}

interface InjectContentAcceptContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
  }
}

export default function (this: InjectContentAcceptContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = require(manifestPath)

  validate(schema, options, {
    name: 'Inject HMR (<script> tags) Accept',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)
  const reloadCode = `
if (import.meta.webpackHot) { import.meta.webpackHot.accept() };
  `

  // Let the react reload plugin handle the reload.
  // WARN: Removing this check will cause the content script to pile up
  // in the browser. This is something related to the react reload plugin
  // or the webpack-target-webextension plugin.
  // TODO: cezaraugusto because of this, entry files of content_scripts
  // written in JSX doesn't reload. This is a bug.
  if (isUsingReact(projectPath)) return source

  const htmlFields = manifestFields(manifestPath, manifest).html

  for (const field of Object.entries(htmlFields)) {
    const [feature, resource] = field

    // Resources from the manifest lib can come as undefined.
    if (resource?.html) {
      if (!fs.existsSync(resource?.html)) return

      const htmlAssets = getAssetsFromHtml(resource?.html)
      const fileAssets = htmlAssets?.js || []

      for (const asset of fileAssets) {
        const absoluteUrl = path.resolve(projectPath, asset)

        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`
        }
      }
    }
  }

  return source
}
