// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {isUsingTypeScript} from '../options/typescript'
import {isUsingVue} from '../options/vue'

export default function vueLoaders(projectDir: string) {
  const vueLoaders = []

  if (isUsingVue(projectDir)) {
    vueLoaders.push({
      test: /\.vue$/,
      loader: 'vue-loader'
    })
  }

  if (isUsingTypeScript(projectDir)) {
    vueLoaders.push({
      test: /\.ts$/,
      exclude: /background\.ts/,
      loader: 'ts-loader',
      options: {appendTsSuffixTo: [/\.vue$/]}
    })
  }
  return vueLoaders
}
