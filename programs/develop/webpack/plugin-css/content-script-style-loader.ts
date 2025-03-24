import type {RuleSetRule} from '@rspack/core'

interface ContentScriptAsset {
  name: string
  info: {
    index?: number
  }
}

export function getContentScriptLoader(): RuleSetRule {
  return {
    test: /\.css$/,
    type: 'asset',
    issuer: (issuer: string) => issuer.includes('content'),
    generator: {
      filename: (pathData: ContentScriptAsset) => {
        const index = pathData.info?.index || 0
        // Add contenthash to avoid naming collisions between different content script CSS files
        return `content_scripts/content-${index}.[contenthash:8].css`
      }
    }
  }
}
