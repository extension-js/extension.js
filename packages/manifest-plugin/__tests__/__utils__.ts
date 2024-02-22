import path from 'path'
import fs from 'fs-extra'

export const getFixturesPath = (demoDir: string) =>
  path.join(__dirname, 'fixtures', demoDir, 'manifest.json')

export const assertFileIsEmitted = async (filePath: string) => {
  await fs.access(filePath, fs.constants.F_OK);
}

export const assertFileIsNotEmitted = async (filePath: string) => {
  await fs.access(filePath, fs.constants.F_OK).catch((err) => {
    expect(err).toBeTruthy()
  });
}

export const findStringInFile = async (filePath: string, string: string) => {
  await fs.readFile(filePath, 'utf8').then((data) => {
    expect(data).toContain(string)
  });
}
