import {mount} from 'svelte'
import SidebarApp from './SidebarApp.svelte'

const container = document.getElementById('app')
if (container) {
  mount(SidebarApp, {
    target: container
  })
}
