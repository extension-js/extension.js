import fs from 'fs';
import webpack, { type Compilation } from 'webpack';
import * as messages from './messages';
import { type FilepathList } from '../types';

export function manifestNotFoundError(compilation: Compilation) {
  const errorMessage = messages.manifestMissingError();

  compilation.errors.push(new webpack.WebpackError(errorMessage));
}

export function entryNotFoundWarn(
  compilation: Compilation,
  feature: string,
  htmlFilePath: string,
) {
  const errorMessage = messages.manifestFieldError(feature, htmlFilePath);

  compilation.warnings.push(new webpack.WebpackError(errorMessage));
}

export function fileNotFoundWarn(
  compilation: Compilation,
  manifestPath: string,
  htmlFilePath: string,
  filePath: string,
) {
  const errorMessage = messages.fileNotFound(
    manifestPath,
    htmlFilePath,
    filePath,
  );

  compilation.warnings.push(new webpack.WebpackError(errorMessage));
}

export function serverStartRequiredError(compilation: Compilation) {
  const errorMessage = messages.serverRestartRequiredFromManifest();

  compilation.errors.push(new webpack.WebpackError(errorMessage));
}

export function noValidFolderError(compilation: webpack.Compilation) {
  const hintMessage2 = `or remove the \`default_locale\` field from your \`manifest.json\` file.`;
  const hintMessage = `Ensure the \`_locales\` folder is valid and available at the root of your project. ${hintMessage2}`;
  const errorMessage = `Default locale was specified, but \`_locales\` subtree is missing. ${hintMessage}`;

  compilation.errors.push(
    new webpack.WebpackError(`[_locales]: ${errorMessage}`),
  );
}

export function manifestInvalidError(
  compilation: webpack.Compilation,
  error: NodeJS.ErrnoException,
) {
  compilation.errors.push(
    new webpack.WebpackError(messages.manifestInvalidError(error)),
  );
}

export function handleHtmlErrors(
  compilation: Compilation,
  includesList: FilepathList,
  WebpackError: typeof webpack.WebpackError,
) {
  const htmlFields = includesList;

  for (const [field, value] of Object.entries(htmlFields)) {
    if (value) {
      const fieldError = messages.manifestFieldError(field, value as string);

      if (!fs.existsSync(value as string)) {
        compilation.errors.push(new WebpackError(fieldError));
      }
    }
  }
}

export function handleIconsErrors(
  compilation: Compilation,
  includesList: FilepathList,
  WebpackError: typeof webpack.WebpackError,
) {
  const iconsFields = includesList;

  for (const [field, value] of Object.entries(iconsFields)) {
    if (value) {
      if (typeof value === 'string') {
        const fieldError = messages.manifestFieldError(field, value);

        if (!fs.existsSync(value)) {
          compilation.errors.push(new WebpackError(fieldError));
        }
      }
    }

    if (value != null && value.constructor.name === 'Object') {
      const icon = value as { light?: string; dark?: string };

      if (icon.light) {
        const fieldError = messages.manifestFieldError(field, icon.light);

        if (!fs.existsSync(icon.dark!)) {
          compilation.errors.push(new WebpackError(fieldError));
        }
      }

      if (icon.dark) {
        const fieldError = messages.manifestFieldError(field, icon.dark);

        if (!fs.existsSync(icon.dark)) {
          compilation.errors.push(new WebpackError(fieldError));
        }
      }
    }

    if (Array.isArray(value)) {
      for (const icon of value) {
        const fieldError = messages.manifestFieldError(field, icon as string);

        if (typeof icon === 'string') {
          if (!fs.existsSync(icon)) {
            compilation.errors.push(new WebpackError(fieldError));
          }
        }
      }
    }
  }
}

export function handleJsonErrors(
  compilation: Compilation,
  includesList: FilepathList,
  WebpackError: typeof webpack.WebpackError,
) {
  const jsonFields = includesList;

  for (const [field, value] of Object.entries(jsonFields)) {
    if (value) {
      const valueArr: string[] = Array.isArray(value) ? value : [value];

      for (const json of valueArr) {
        const fieldError = messages.manifestFieldError(field, json);

        if (!fs.existsSync(json)) {
          compilation.errors.push(new WebpackError(fieldError));
        }
      }
    }
  }
}

export function handleScriptsErrors(
  compilation: Compilation,
  includesList: FilepathList,
  WebpackError: typeof webpack.WebpackError,
) {
  const scriptsFields = includesList;

  for (const [field, value] of Object.entries(scriptsFields)) {
    if (value) {
      const valueArr = Array.isArray(value) ? value : [value];

      for (const script of valueArr) {
        if (field.startsWith('content_scripts')) {
          const [featureName, index] = field.split('-');
          const prettyFeature = `${featureName} (index ${index})`;
          const fieldError = messages.manifestFieldError(prettyFeature, script);

          if (!fs.existsSync(script)) {
            compilation.errors.push(new WebpackError(fieldError));
          }
        } else {
          const fieldError = messages.manifestFieldError(field, script);

          if (!fs.existsSync(script)) {
            compilation.errors.push(new WebpackError(fieldError));
          }
        }
      }
    }
  }
}
