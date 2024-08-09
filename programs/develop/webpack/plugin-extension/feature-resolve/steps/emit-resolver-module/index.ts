import fs from 'fs'
import {type ResolvePluginContext} from '../loader-types'
import {getFileList} from '../get-file-list'

export function emitResolverModule(
  loader: ResolvePluginContext,
  resolverAbsolutePath: string
) {
  const options = loader.getOptions()
  const {manifestPath, includeList} = options

  const includeListModule = JSON.stringify(
    getFileList(manifestPath, includeList)
  )

  const resolverModule = fs.readFileSync(resolverAbsolutePath, 'utf8')
  const module = resolverModule.replace(
    '"__RESOLVER_MODULE_FILE_LIST__"',
    `${includeListModule}`
  )

  // Emit the resolver module. This rewrites
  // original resolver module with the new file list.
  fs.writeFileSync(resolverAbsolutePath, module)
}
