import {value} from './shared/constant.js'

const isWorker = typeof importScripts === 'function'
const isMV3 =
  typeof chrome === 'object' &&
  chrome.runtime.getManifest().manifest_version === 3

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept('./shared/constant.js', () => {
    console.log(`${head} constant updated to`, value)
  })

  // const head = `[HMR test]${isWorker ? ' [Inside Worker]' : ''}`
  // if (isWorker) {
  //   if (isMV3)
  //     console.warn(
  //       head,
  //       'HMR for MV3 background service worker is not possible. See https://bugs.chromium.org/p/chromium/issues/detail?id=1198822'
  //     )
  //   else console.warn(head, 'HMR in Worker does not work. Help wanted.')
  // }
  console.log(
    `${head} constant =`,
    value,
    '. Try edit /shared/constant.js to see changes'
  )
}
