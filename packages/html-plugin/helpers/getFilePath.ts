export default function getFilePath(
  outputname: string,
  extension: string,
  isAbsolute?: boolean
) {
  return isAbsolute ? `/${outputname}${extension}` : `${outputname}${extension}`
}
