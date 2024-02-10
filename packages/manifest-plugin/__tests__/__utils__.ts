import path from 'path'
import fs from 'fs-extra'

export const getFixturesPath = (demoDir: string) =>
  path.join(__dirname, 'fixtures', demoDir, 'manifest.json')

export const assertFileIsEmitted = (filePath: string) => {
  return fs.access(filePath, fs.constants.F_OK)
}

export const assertFileIsNotEmitted = (filePath: string) => {
  return fs.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  })
}

export const findStringInFile = (filePath: string, string: string) => {
  return fs.readFile(filePath, 'utf8').then((data) => {
    expect(data).toContain(string)
  })
}
