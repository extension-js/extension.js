import {type Manifest} from '../../../../webpack-types'

export function commands(manifest: Manifest) {
  return (
    manifest.commands && {
      commands: manifest.commands
    }
  )
}
