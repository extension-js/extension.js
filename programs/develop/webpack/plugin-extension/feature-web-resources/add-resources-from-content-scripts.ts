import type webpack from 'webpack';
import manifestFields from 'browser-extension-manifest-fields';
import { shouldExclude } from '../../lib/utils';
import { type FilepathList, type PluginInterface } from '../../types';

export class OutputWebAccessibleResourcesFolder {
  private readonly manifestPath: string;
  private readonly includeList?: FilepathList;
  private readonly excludeList?: FilepathList;

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath;
    this.includeList = options.includeList;
    this.excludeList = options.excludeList;
  }

  private getContentScriptsCss() {
    const manifestScripts = manifestFields(this.manifestPath).scripts;
    const contentScriptsEntries = Object.entries(manifestScripts);
    const contentScripts = contentScriptsEntries.filter(([key]) => {
      return key.startsWith('content_scripts');
    });
    const contentScriptsCss = contentScripts.filter(([key]) => {
      return (
        key.endsWith('.css') ||
        key.endsWith('.scss') ||
        key.endsWith('.sass') ||
        key.endsWith('.less')
      );
    });

    return contentScriptsCss;
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.afterCompile.tapAsync(
      'WebResourcesPlugin (AutoParseWebResourcesFolder)',
      (compilation, done) => {
        const { web_accessible_resources: webAccResources } = manifestFields(
          this.manifestPath
        );
        const contentScriptsCss = this.getContentScriptsCss();

        if (webAccResources?.length) {
          for (const resource of webAccResources) {
            // Manifest V2
            if (typeof resource === 'string') {
              const isContentCss = contentScriptsCss?.some(
                ([key]) => key === resource
              );

              if (!isContentCss) {
                if (!shouldExclude(resource, this.excludeList)) {
                  compilation.assets[`web_accessible_resources/${resource}`] =
                    compilation.assets[resource];
                }
              }
            } else {
              // Manifest V3
              resource.forEach((resourcePath, index) => {
                const isContentCss = contentScriptsCss?.some(
                  ([key]) => key === resourcePath
                );

                if (!isContentCss) {
                  if (!shouldExclude(resourcePath, this.excludeList)) {
                    compilation.assets[
                      `web_accessible_resources/resource-${index}/${resourcePath}`
                    ] = compilation.assets[resourcePath];
                  }
                }
              });
            }
          }
        }

        done();
      }
    );
  }
}
