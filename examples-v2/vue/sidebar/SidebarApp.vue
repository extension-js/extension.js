<template>
  <div class="p-4">
    <header class="text-center">
      <h1 class="mb-4">
        <img
          class="vue mx-auto mb-2"
          :src="vueLogo"
          alt="The Vue logo"
          width="120px"
        />
        <br />
        Welcome to your Vue Extension
      </h1>
      <p class="text-gray-600">
        Learn more about creating cross-browser extensions at
        <a
          href="https://extension.js.org"
          target="_blank"
          class="text-blue-600 hover:underline"
        >
          https://extension.js.org
        </a>
        .
      </p>
    </header>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import vueLogo from '../images/vue.png'

export default defineComponent({
  name: 'SidebarApp',
  setup() {
    return {
      vueLogo,
    }
  },
})
</script>

<style>
.vue {
  animation: spin 20s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style> 