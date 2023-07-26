import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function optionsPage(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.options_page && {
      options_page: getFilename('options_ui', manifest.options_page, exclude)
    }
  )
}
