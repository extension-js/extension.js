<script lang="ts">
  import svelteLogo from '../images/svelte.png'
</script>

<div class="p-4">
  <header class="text-center">
    <h1 class="mb-4">
      <img
        class="svelte mx-auto mb-2"
        src={svelteLogo}
        alt="The Svelte logo"
        width="120px"
      />
      <br />
      Welcome to your Svelte Extension
    </h1>
    <p class="text-gray-600">
      Learn more about creating cross-browser extensions at{' '}
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

<style>
  .svelte {
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