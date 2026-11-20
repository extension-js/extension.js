import {describe, expect, it} from 'vitest'
import {npmNameProblem, packageNameFor} from '../package-name'

// The rules npm applies to a new package name, one row each.
describe('npm takes a package name', () => {
  it.each([
    'my-extension',
    'a',
    'x.y_z',
    'v1.0-beta',
    '@scope/name',
    'a'.repeat(214)
  ])('accepts %s', (name) => {
    expect(npmNameProblem(name)).toBeNull()
  })

  it.each([
    ['', 'it is empty'],
    ['a'.repeat(215), 'it is longer than 214 characters'],
    ['.hidden', 'it starts with a dot'],
    ['_private', 'it starts with an underscore'],
    [' padded', 'it starts or ends with a space'],
    ['Capital', 'it has capital letters'],
    ['bad name!', 'it has characters npm does not allow'],
    ["it's", 'it has characters npm does not allow'],
    ['tilde~', 'it has characters npm does not allow'],
    ['café', 'it has characters npm does not allow'],
    ['node_modules', 'npm reserves that name'],
    ['favicon.ico', 'npm reserves that name'],
    ['@scope/Name', 'it has capital letters'],
    ['@/name', 'it has characters npm does not allow'],
    ['@scope/.name', 'it has characters npm does not allow']
  ])('refuses %j because %s', (name, problem) => {
    expect(npmNameProblem(name)).toBe(problem)
  })
})

describe('the package name create writes for a folder name', () => {
  it.each([
    ['my-extension', 'my-extension'],
    ['bad name!', 'bad-name'],
    ['My Extension', 'my-extension'],
    ['  spaced   out  ', 'spaced-out'],
    ['.hidden', 'hidden'],
    ['__private', 'private'],
    ["it's mine", 'its-mine'],
    ['v1.0 (beta)', 'v1.0-beta'],
    ['@handle', 'handle']
  ])('names %j as %j', (folder, name) => {
    expect(packageNameFor(folder)).toEqual({
      name,
      derived: folder !== name
    })
  })

  // Dropping a letter or a digit, or cutting the name short, would pick a
  // name the user did not type, so nothing is derived.
  it.each([
    ['café', 'it has characters npm does not allow'],
    ['日本', 'it has characters npm does not allow'],
    ['!!!', 'it has characters npm does not allow'],
    ['node_modules', 'npm reserves that name'],
    ['favicon.ico', 'npm reserves that name'],
    ['a'.repeat(215), 'it is longer than 214 characters']
  ])('derives nothing from %j', (folder, problem) => {
    expect(packageNameFor(folder)).toEqual({problem})
  })
})
