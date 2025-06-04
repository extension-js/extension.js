import * as svelte from 'svelte'
import './styles.css'
import SidebarApp from './SidebarApp.svelte'

const container = document.getElementById('app')
const app = svelte.mount(SidebarApp, {
  target: container as HTMLElement
})

export default app
