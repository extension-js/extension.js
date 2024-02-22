import path from 'path'
import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

const getBasename = (filepath: string) => path.basename(filepath)
export default function pageAction(manifest: Manifest, exclude: string[]) {
  return (
    manifest.page_action && {
      page_action: {
        ...manifest.page_action,
        ...(manifest.page_action.default_popup && {
          default_popup: getFilename(
            'page_action/default_popup.html',
            manifest.page_action.default_popup as string,
            exclude
          )
        }),
        ...(manifest.page_action.default_icon && {
          default_icon:
            typeof manifest.page_action.default_icon === 'string'
              ? getFilename(
                  `page_action/${getBasename(manifest.page_action.default_icon as string)}`,
                  manifest.page_action.default_icon as string,
                  exclude
                )
              : Object.fromEntries(
                  Object.entries(
                    manifest.page_action.default_icon as Record<string, string>
                  ).map(([size, icon]) => {
                    return [
                      size,
                      getFilename(
                        `page_action/${getBasename(icon)}`,
                        icon,
                        exclude
                      )
                    ]
                  })
                )
        })
      }
    }
  )
}
