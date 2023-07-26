import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function contentScripts(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.content_scripts && {
      content_scripts: manifest.content_scripts.map(
        (contentObj: {js: string[]; css: string[]}, index: number) => {
          return {
            ...contentObj,
            js:
              contentObj.js &&
              contentObj.js.map((js: string) => {
                return getFilename(`content_scripts-${index}`, js, exclude)
              }),
            css:
              contentObj.css &&
              contentObj.css.map((css: string) => {
                return getFilename(`content_scripts-${index}`, css, exclude)
              })
          }
        }
      )
    }
  )
}
