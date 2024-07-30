import fs from 'fs';
import path from 'path';
import type webpack from 'webpack';
import { sources, Compilation } from 'webpack';
import { type FilepathList, type PluginInterface } from '../../../types';
import { shouldExclude } from '../../../lib/utils';

export class EmitFile {
  public readonly manifestPath: string;
  public readonly includeList?: FilepathList;
  public readonly excludeList?: FilepathList;

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath;
    this.includeList = options.includeList;
    this.excludeList = options.excludeList;
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap('icons:emit-file', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'icons:emit-file',
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER,
        },
        () => {
          if (compilation.errors.length > 0) return;

          const iconFields = this.includeList || {};

          for (const field of Object.entries(iconFields)) {
            const [feature, resource] = field;

            if (resource === undefined) continue;

            const iconEntries: string[] = Array.isArray(resource)
              ? typeof resource[0] === 'string'
                ? resource
                : resource.map(Object.values).flat()
              : [resource];

            for (const entry of iconEntries) {
              // Resources from the manifest lib can come as undefined.
              if (entry) {
                // Do not output if file doesn't exist.
                // If the user updates the path, this script runs again
                // and output the file accordingly.
                if (!fs.existsSync(entry)) {
                  // WARN: This is handled by the manifest plugin.
                  // Do not add an error handler here.
                  continue;
                }

                if (!shouldExclude(entry, this.excludeList)) {
                  const source = fs.readFileSync(entry);
                  const rawSource = new sources.RawSource(source);

                  const basename = path.basename(entry);
                  // Output theme_icons to the same folder as browser_action
                  // TODO: cezaraugusto at some point figure out a standard
                  // way to output paths from the manifest fields.
                  const featureName = feature.endsWith('theme_icons')
                    ? feature.replace('theme_icons', '')
                    : feature;
                  const filename = `${featureName}/${basename}`;

                  compilation.emitAsset(filename, rawSource);
                }
              }
            }
          }
        }
      );
    });
  }
}
