import {type LoaderContext, type FilepathList} from '../../../webpack-types'
import {type DevOptions} from '../../../../commands/commands-lib/config-types'

export interface ResolvePluginContext extends LoaderContext {
  resourcePath: string
  getOptions: () => {
    test: string
    manifestPath: string
    browser: DevOptions['browser']
    includeList: FilepathList
    excludeList: FilepathList
    typescript: boolean
    jsx: boolean
  }
}
