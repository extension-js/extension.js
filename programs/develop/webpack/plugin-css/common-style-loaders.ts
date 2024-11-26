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
}

// function whereToInsertStyleTag(element: HTMLElement) {
//   // Function to check if the shadow root exists
//   const insertElement = () => {
//     // @ts-expect-error - global reference.
//     const shadowRoot = window.__EXTENSION_SHADOW_ROOT__

//     if (shadowRoot) {
//       shadowRoot.appendChild(element)

//       if (process.env.EXTENSION_ENV === 'development') {
//         console.log('Element inserted into shadowRoot')
//       }
//     } else {
//       document.head.appendChild(element)
//       if (process.env.EXTENSION_ENV === 'development') {
//         console.log('Element inserted into document.head')
//       }
//     }
//   }

//   // If the shadowRoot is already available, insert immediately
//   // @ts-expect-error - global reference.
//   if (window.__EXTENSION_SHADOW_ROOT__) {
//     insertElement()
//     return
//   }

//   // Use MutationObserver to wait for the shadow root to be available
//   const observer = new MutationObserver(() => {
//     // @ts-expect-error - global reference.
//     if (window.__EXTENSION_SHADOW_ROOT__) {
//       insertElement()
//       observer.disconnect() // Stop observing once the shadow root is found
//     } else {
//       // Disconnect the observer if the shadow root is not found after 5 seconds
//       setTimeout(() => {
//         observer.disconnect()
//       }, 5000)
//     }
//   })

//   // Observe changes to the `document.body` or `document.head`
//   observer.observe(document.body, {childList: true, subtree: true})
// }

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
          // options: {
          //   insert: whereToInsertStyleTag
          // }
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
