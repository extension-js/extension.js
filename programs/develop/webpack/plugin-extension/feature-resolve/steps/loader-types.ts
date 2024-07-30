import {type LoaderContext, type FilepathList} from '../../../webpack-types'

export interface ResolvePluginContext extends LoaderContext {
  resourcePath: string
  getOptions: () => {
    test: string
    manifestPath: string
    includeList: FilepathList
    excludeList: FilepathList
    typescript: boolean
    jsx: boolean
  }
}
