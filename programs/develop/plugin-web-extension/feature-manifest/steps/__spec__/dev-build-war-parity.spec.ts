import {describe, expect, it} from 'vitest'
import {
  DEV_RUNTIME_RESOURCES,
  patchWebResources
} from '../apply-dev-defaults-lib/patch-web-resources'

type WarGroup = {resources: string[]; matches: string[]}

function resourcesOf(manifest: Record<string, unknown>): string[] {
  const war = manifest.web_accessible_resources

  if (!Array.isArray(war)) return []

  return war.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : (entry as WarGroup).resources || []
  )
}

// The dev session and the production build must expose the same files. Any
// extra file page-reachable in dev alone works until the extension ships.
describe('dev and build agree on web_accessible_resources', () => {
  const builtManifests: Array<Record<string, unknown>> = [
    {
      manifest_version: 3,
      content_scripts: [{matches: ['https://example.com/*']}]
    },
    {
      manifest_version: 3,
      content_scripts: [{matches: ['https://example.com/*']}],
      web_accessible_resources: [
        {resources: ['payload.json'], matches: ['https://example.com/*']}
      ]
    },
    {
      manifest_version: 2,
      content_scripts: [{matches: ['<all_urls>']}],
      web_accessible_resources: ['payload.json']
    }
  ]

  it('adds nothing to the built manifest beyond the dev runtime files', () => {
    for (const built of builtManifests) {
      const dev = {...built, ...patchWebResources(built as never)}
      const added = resourcesOf(dev).filter(
        (resource) => !resourcesOf(built).includes(resource)
      )

      expect(added).toEqual([...DEV_RUNTIME_RESOURCES])
      // Pinned as written: a wider constant would pass the line above and
      // still put a new file in reach of every matched page.
      expect(added).toEqual(['hot/*', 'extension-js-control.json'])
    }
  })

  it('keeps every dev-only resource out of the shipped surface', () => {
    for (const built of builtManifests) {
      const dev = {...built, ...patchWebResources(built as never)}

      for (const resource of resourcesOf(dev)) {
        const isBuilt = resourcesOf(built).includes(resource)
        const isDevRuntime = (DEV_RUNTIME_RESOURCES as string[]).includes(
          resource
        )

        expect(isBuilt || isDevRuntime).toBe(true)
      }
    }
  })

  it('never grants a glob that exposes bundled files to any page', () => {
    for (const built of builtManifests) {
      const dev = {...built, ...patchWebResources(built as never)}
      const war = dev.web_accessible_resources

      for (const entry of Array.isArray(war) ? war : []) {
        if (typeof entry === 'string') continue

        const group = entry as WarGroup
        if (!group.matches.includes('<all_urls>')) continue

        if (
          (
            built.content_scripts as Array<{matches: string[]}>
          )[0].matches.includes('<all_urls>')
        ) {
          continue
        }

        expect(group.resources).toEqual([])
      }
    }
  })
})
