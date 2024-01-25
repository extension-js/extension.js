/** global __webpack_require__ */

console.log('the great loader is running')
export default function browserExtensionRuntimeResolver (dataType: any) {
  console.log('the great loader is being called by', dataType)
  if ('url' in dataType) {
    // @ts-ignore
    console.log(__webpack_require__.r(dataType.url))
  }
  return dataType
}
