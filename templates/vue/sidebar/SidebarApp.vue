<template>
  <div class="sidebar_app">
    <img class="sidebar_logo" :src="vueLogo" alt="The Vue logo" />
    <h1 class="sidebar_title">Welcome to your<br />Vue Extension</h1>
    <p class="sidebar_description">
      Learn more about creating cross-browser extensions at
      <a href="https://extension.js.org" target="_blank" rel="noopener noreferrer">
        https://extension.js.org
      </a>
    </p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import vueLogo from '../images/logo.svg'

export default defineComponent({
  name: 'SidebarApp',
  setup() {
    return {
      vueLogo
    }
  }
})
</script>
