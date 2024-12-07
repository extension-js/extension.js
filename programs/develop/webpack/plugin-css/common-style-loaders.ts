import {type RuleSetRule} from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {isUsingTailwind} from './css-tools/tailwind'
import {isUsingSass} from './css-tools/sass'
import {isUsingLess} from './css-tools/less'
import {maybeUsePostCss} from './css-tools/postcss'

export interface StyleLoaderOptions {
  mode: DevOptions['mode']
  useMiniCssExtractPlugin: boolean
  loader?: string
  useShadowDom: boolean
}

function whereToInsertStyleTag(element: HTMLElement) {
  // Function to insert the style tag
  const insertElement = () => {
    // @ts-expect-error - global reference.
    const shadowRoot = window.__EXTENSION_SHADOW_ROOT__

    if (shadowRoot) {
      shadowRoot.appendChild(element)
      console.log('Element inserted into shadowRoot')
    } else {
      document.head.appendChild(element)
      console.log('Element inserted into document.head')
    }
  }

  // If the shadowRoot is already available, insert immediately
  // @ts-expect-error - global reference.
  if (window.__EXTENSION_SHADOW_ROOT__) {
    insertElement()
    return
  }

  // Default behavior if MutationObserver is not required
  if (!MutationObserver) {
    document.head.appendChild(element)
    return
  }

  // Use MutationObserver to wait for the shadow root to be available
  const observer = new MutationObserver(() => {
    // @ts-expect-error - global reference.
    if (window.__EXTENSION_SHADOW_ROOT__) {
      insertElement()
      observer.disconnect() // Stop observing once the shadow root is found
    }
  })

  // Observe changes to the `document.body` or `document.head`
  observer.observe(document.body, {childList: true, subtree: true})

  // Set a timeout to fallback to `document.head` after 5 seconds
  setTimeout(() => {
    observer.disconnect() // Stop observing after timeout
    // @ts-expect-error - global reference.
    if (!window.__EXTENSION_SHADOW_ROOT__) {
      document.head.appendChild(element)
      console.log('Fallback: Element inserted into document.head after timeout')
    }
  }, 3000)
}

export async function commonStyleLoaders(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<RuleSetRule['use']> {
  const miniCssLoader = MiniCssExtractPlugin.loader
  const styleLoaders: RuleSetRule['use'] = [
    opts.useMiniCssExtractPlugin
      ? miniCssLoader
      : {
          loader: require.resolve('style-loader'),
          options:
            (opts.useShadowDom && {
              insert: whereToInsertStyleTag
            }) ||
            undefined
        },
    {
      loader: require.resolve('css-loader'),
      options: {
        sourceMap: opts.mode === 'development'
      }
    }
  ].filter(Boolean)

  if (
    isUsingTailwind(projectPath) ||
    isUsingSass(projectPath) ||
    isUsingLess(projectPath)
  ) {
    const maybeInstallPostCss = await maybeUsePostCss(projectPath, opts)
    if (maybeInstallPostCss.loader) {
      styleLoaders.push(maybeInstallPostCss)
    }
  }

  if (opts.loader) {
    styleLoaders.push(
      ...[
        {
          loader: require.resolve('resolve-url-loader'),
          options: {
            sourceMap: opts.mode === 'development',
            root: projectPath
          }
        },
        {
          loader: require.resolve(opts.loader),
          options: {
            sourceMap: opts.mode === 'development'
          }
        }
      ]
    )
  }

  return styleLoaders.filter(Boolean)
}
