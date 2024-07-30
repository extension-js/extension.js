import path from 'path';
import fs from 'fs';
import { urlToRequest } from 'loader-utils';
import { validate } from 'schema-utils';
import { type Schema } from 'schema-utils/declarations/validate';
import { LoaderInterface } from '../../../types';
import { getAssetsFromHtml } from '../html-lib/utils';

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string',
    },
    manifestPath: {
      type: 'string',
    },
    includeList: {
      type: 'object',
    },
    excludeList: {
      type: 'object',
    },
  },
};

export default function ensureHMRForScripts(
  this: LoaderInterface,
  source: string
) {
  const options = this.getOptions();
  const manifestPath = options.manifestPath;
  const projectPath = path.dirname(manifestPath);

  validate(schema, options, {
    name: 'html:ensure-hmr-for-scripts',
    baseDataPath: 'options',
  });

  const url = urlToRequest(this.resourcePath);
  const reloadCode = `
if (import.meta.webpackHot) { import.meta.webpackHot.accept() };
  `;
  // Let the react reload plugin handle the reload.
  // WARN: Removing this check will cause the content script to pile up
  // in the browser. This is something related to the react reload plugin
  // or the webpack-target-webextension plugin.
  // TODO: cezaraugusto because of this, entry files of content_scripts
  // written in JSX doesn't reload. This is a bug.
  // TODO: cezaraugust oundo this
  // if (isUsingReact(projectPath)) return source;

  const allEntries = options.includeList || {};

  for (const field of Object.entries(allEntries)) {
    const [, resource] = field;

    // Resources from the manifest lib can come as undefined.
    if (resource) {
      if (!fs.existsSync(resource as string)) return;

      const htmlAssets = getAssetsFromHtml(resource as string);
      const fileAssets = htmlAssets?.js || [];

      for (const asset of fileAssets) {
        const absoluteUrl = path.resolve(projectPath, asset);

        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`;
        }
      }
    }
  }

  return source;
}
