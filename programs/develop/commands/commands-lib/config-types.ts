import {Configuration} from 'webpack'

export interface FileConfig {
  config: (config: Configuration) => Configuration
}
