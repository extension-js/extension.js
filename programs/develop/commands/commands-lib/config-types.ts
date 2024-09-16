import {Configuration} from 'webpack'
import {DevOptions} from '../dev'
import {StartOptions} from '../start'
import {PreviewOptions} from '../preview'
import {BuildOptions} from '../build'

export interface FileConfig {
  dev: DevOptions
  start: StartOptions
  preview: PreviewOptions
  build: BuildOptions
  config: (config: Configuration) => Configuration
}
