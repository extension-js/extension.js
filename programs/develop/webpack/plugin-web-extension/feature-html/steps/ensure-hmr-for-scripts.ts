// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import type {LoaderInterface} from '../../../webpack-types'

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
    }
  },
  additionalProperties: false
}

export default function ensureHMRForScripts(
  this: LoaderInterface,
  source: string
) {
  const resourceQuery = String(this.resourceQuery || '')
  if (resourceQuery.includes('vue&type=')) {
    return source
  }

  const options = this.getOptions()

  try {
    validate(schema, options, {
      name: 'html:ensure-hmr-for-scripts',
      baseDataPath: 'options'
    })
  } catch (error) {
    throw error
  }

  const reloadCode = `
if (import.meta.webpackHot) {
  try {
    // Accept updates for HTML-attached scripts and clear common containers
    import.meta.webpackHot.accept();
    import.meta.webpackHot.dispose(function() {
      try {
        var clear = function(el) {
          if (!el) return;
          while (el.firstChild) el.removeChild(el.firstChild);
        };

        // Clear default template container
        clear(document.getElementById('app'));

        // Also clear any extension-root wrappers if present
        var roots = document.querySelectorAll('[data-extension-root]');
        roots.forEach(function(node) {
          clear(node);
        });
      } catch (err) {
        // 'err' is local in this catch, keep for error clarity
        console.error('Error clearing HTML containers', err);
      }
    });
  } catch (error) {
    console.error('Error accepting HMR', error);
  }
}
`
  // Minimal behavior: inject HMR accept wrapper for any handled script
  return `${reloadCode}${source}`
}
