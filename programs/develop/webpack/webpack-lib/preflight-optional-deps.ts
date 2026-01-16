// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {getDirs} from './paths'
import type {ProjectStructure} from './project'
import type {DevOptions} from '../webpack-types'
import {maybeUseReact} from '../plugin-js-frameworks/js-tools/react'
import {maybeUsePreact} from '../plugin-js-frameworks/js-tools/preact'
import {maybeUseVue} from '../plugin-js-frameworks/js-tools/vue'
import {maybeUseSvelte} from '../plugin-js-frameworks/js-tools/svelte'
import {maybeUseTypeScript} from '../plugin-js-frameworks/js-tools/typescript'
import {maybeUseSass} from '../plugin-css/css-tools/sass'
import {maybeUseLess} from '../plugin-css/css-tools/less'
import {maybeUsePostCss} from '../plugin-css/css-tools/postcss'

export async function preflightOptionalDependencies(
  projectStructure: ProjectStructure,
  mode: DevOptions['mode']
) {
  const {packageJsonDir} = getDirs(projectStructure)
  const projectPath = packageJsonDir as string

  await maybeUseTypeScript(projectPath)
  await maybeUseReact(projectPath)
  await maybeUsePreact(projectPath)
  await maybeUseVue(projectPath)
  await maybeUseSvelte(projectPath, mode)

  await maybeUseSass(projectPath)
  await maybeUseLess(projectPath, projectStructure.manifestPath)
  await maybeUsePostCss(projectPath, {mode})
}
