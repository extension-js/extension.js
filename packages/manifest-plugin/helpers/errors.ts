import fs from 'fs'
import webpack, {Compilation} from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'

import messages from './messages'

function manifestNotFoundError(compilation: webpack.Compilation) {
  compilation.errors.push(
    new webpack.WebpackError(
      `[manifest.json]: ${messages.manifestNotFoundError}`
    )
  )
}

function manifestInvalidError(compilation: webpack.Compilation, error: any) {
  compilation.errors.push(
    new webpack.WebpackError(
      `[manifest.json]: ${messages.manifestInvalidError}`
    )
  )
}

function handleHtmlErrors(
  compilation: Compilation,
  manifestPath: string,
  WebpackError: typeof webpack.WebpackError
) {
  const manifest = require(manifestPath)
  const htmlFields = manifestFields(manifestPath, manifest).html

  for (const [field, value] of Object.entries(htmlFields)) {
    if (value) {
      const fieldError = messages.manifestFieldError(field, value?.html)

      if (!fs.existsSync(value.html)) {
        compilation.errors.push(new WebpackError(fieldError))
      }
    }
  }
}

function handleIconsErrors(
  compilation: Compilation,
  manifestPath: string,
  WebpackError: typeof webpack.WebpackError
) {
  const manifest = require(manifestPath)
  const iconsFields = manifestFields(manifestPath, manifest).icons

  for (const [field, value] of Object.entries(iconsFields)) {
    if (value) {
      if (typeof value === 'string') {
        const fieldError = messages.manifestFieldError(field, value)

        if (!fs.existsSync(value)) {
          compilation.errors.push(new WebpackError(fieldError))
        }
      }
    }

    if (value != null && value.constructor.name === 'Object') {
      const icon = value as {light?: string; dark?: string}

      if (icon.light) {
        const fieldError = messages.manifestFieldError(
          field,
          icon.light as string
        )

        if (!fs.existsSync(icon.dark as string)) {
          compilation.errors.push(new WebpackError(fieldError))
        }
      }

      if (icon.dark) {
        const fieldError = messages.manifestFieldError(
          field,
          icon.dark as string
        )

        if (!fs.existsSync(icon.dark as string)) {
          compilation.errors.push(new WebpackError(fieldError))
        }
      }
    }

    if (Array.isArray(value)) {
      for (const icon of value) {
        const fieldError = messages.manifestFieldError(field, icon as string)

        if (typeof icon === 'string') {
          if (!fs.existsSync(icon)) {
            compilation.errors.push(new WebpackError(fieldError))
          }
        }
      }
    }
  }
}

function handleJsonErrors(
  compilation: Compilation,
  manifestPath: string,

  WebpackError: typeof webpack.WebpackError
) {
  const manifest = require(manifestPath)
  const jsonFields = manifestFields(manifestPath, manifest).json

  for (const [field, value] of Object.entries(jsonFields)) {
    if (value) {
      const valueArr = Array.isArray(value) ? value : [value]

      for (const json of valueArr) {
        const fieldError = messages.manifestFieldError(field, json)

        if (!fs.existsSync(json)) {
          compilation.errors.push(new WebpackError(fieldError))
        }
      }
    }
  }
}

function handleScriptsErrors(
  compilation: Compilation,
  manifestPath: string,

  WebpackError: typeof webpack.WebpackError
) {
  const manifest = require(manifestPath)
  const scriptsFields = manifestFields(manifestPath, manifest).scripts

  for (const [field, value] of Object.entries(scriptsFields)) {
    if (value) {
      const valueArr = Array.isArray(value) ? value : [value]

      for (const script of valueArr) {
        if (field.startsWith('content_scripts')) {
          const [featureName, index] = field.split('-')
          const prettyFeature = `${featureName} (index ${index})`
          const fieldError = messages.manifestFieldError(prettyFeature, script)

          if (!fs.existsSync(script)) {
            compilation.errors.push(new WebpackError(fieldError))
          }
        } else {
          const fieldError = messages.manifestFieldError(field, script)

          if (!fs.existsSync(script)) {
            compilation.errors.push(new WebpackError(fieldError))
          }
        }
      }
    }
  }
}

export default {
  manifestNotFoundError,
  manifestInvalidError,
  handleHtmlErrors,
  handleIconsErrors,
  handleJsonErrors,
  handleScriptsErrors
}
