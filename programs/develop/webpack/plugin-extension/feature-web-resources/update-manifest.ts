import { type Compiler, Compilation, sources } from 'webpack';
import {
  type FilepathList,
  type PluginInterface,
  type Manifest,
} from '../../types';
import { getManifestContent } from '../../lib/utils';

interface ContentData {
  feature: string;
  matches: string[] | undefined;
}

export class UpdateManifest {
  public readonly manifestPath: string;
  public readonly includeList?: FilepathList;
  public readonly excludeList?: FilepathList;

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath;
    this.includeList = options.includeList;
    this.excludeList = options.excludeList;
  }

  private addFolderToWebResourcesField(
    manifest: Manifest,
    data: ContentData
  ): Manifest {
    const isV2 = manifest.manifest_version === 2;
    const isV3 = manifest.manifest_version === 3;
    const contentPath = 'web_accessible_resources/*';

    let webAccessibleResources:
      | chrome.runtime.ManifestV2['web_accessible_resources']
      | chrome.runtime.ManifestV3['web_accessible_resources'] =
      manifest.web_accessible_resources;

    // Check for Manifest V2
    if (isV2) {
      if (!manifest.web_accessible_resources) {
        webAccessibleResources = [contentPath];
      } else if (Array.isArray(manifest.web_accessible_resources)) {
        if (!manifest.web_accessible_resources.includes(contentPath)) {
          manifest.web_accessible_resources.push(contentPath);
        }
      }
    }

    // Check for Manifest V3
    if (isV3) {
      const newResource: chrome.runtime.ManifestV3['web_accessible_resources'] =
        [
          {
            resources: ['web_accessible_resources/*'],
            matches: data.matches || [],
          },
        ];

      if (!webAccessibleResources) {
        webAccessibleResources = newResource;
      } else if (Array.isArray(webAccessibleResources)) {
        // Check if the resource already exists
        const war = manifest.web_accessible_resources as {
          resources: string[];
          matches: string[];
        }[];

        const existingResources = war.filter(
          (resource) =>
            JSON.stringify(resource.matches) === JSON.stringify(data.matches)
        );

        if (existingResources.length) {
          const hasContentPath = existingResources.some((resource) =>
            resource.resources.includes(contentPath)
          );

          if (!hasContentPath) {
            existingResources.forEach((resource) => {
              resource.resources.push(contentPath);
            });
          }
        } else {
          // @ts-expect-error - This is a hack to make the types work
          webAccessibleResources.push(...newResource);
        }
      }
    }

    return manifest;
  }

  apply(compiler: Compiler) {
    const scriptFields = this.includeList || {};

    compiler.hooks.thisCompilation.tap(
      'ResourcesPlugin (UpdateManifest)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'ResourcesPlugin (UpdateManifest)',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
          },
          (assets) => {
            if (compilation.errors.length > 0) return;

            const manifest = getManifestContent(compilation, this.manifestPath);

            const matches =
              manifest.content_scripts?.flatMap(
                (contentScript) => contentScript.matches || []
              ) || [];

            let patchedManifest = manifest;

            for (const [feature] of Object.entries(scriptFields)) {
              if (feature.startsWith('content_scripts')) {
                const contentData = { feature, matches };

                patchedManifest = this.addFolderToWebResourcesField(
                  patchedManifest,
                  contentData
                );
              }
            }

            const source = JSON.stringify(patchedManifest, null, 2);
            const rawSource = new sources.RawSource(source);

            if (assets['manifest.json']) {
              compilation.updateAsset('manifest.json', rawSource);
            } else {
              compilation.emitAsset('manifest.json', rawSource);
            }
          }
        );
      }
    );
  }
}
