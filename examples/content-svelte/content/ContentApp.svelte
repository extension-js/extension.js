<script lang="ts">
  import svelteLogo from '../images/svelte.png'
  import tailwindBg from '../images/tailwind_bg.png'
  import typescriptLogo from '../images/typescript.png'
  import tailwindLogo from '../images/tailwind.png'
  import chromeWindowBg from '../images/chromeWindow.png'

  let isDialogOpen = true

  function toggleDialog() {
    isDialogOpen = !isDialogOpen
  }
</script>

{#if !isDialogOpen}
  <div class="mx-auto p-6">
    <button
      on:click={toggleDialog}
      class="bg-white rounded-md p-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      🧩 Open content script hint <span aria-hidden="true">+</span>
    </button>
  </div>
{:else}
  <div class="mx-auto max-w-7xl md:px-0 lg:p-6">
    <div class="relative isolate overflow-hidden bg-gray-900 px-6 pt-16 shadow-2xl lg:rounded-3xl md:pt-24 md:h-full sm:h-[100vh] lg:flex lg:gap-x-20 lg:px-24 lg:pt-0">
      <div class="absolute z-20 top-0 inset-x-0 flex justify-center overflow-hidden pointer-events-none">
        <div class="w-[108rem] flex-none flex justify-end">
          <picture>
            <img
              src={tailwindBg}
              alt=""
              class="w-[90rem] flex-none max-w-none hidden dark:block"
              decoding="async"
            />
          </picture>
        </div>
      </div>
      <div class="mx-auto max-w-md text-center lg:py-12 lg:mx-0 lg:flex-auto lg:text-left">
        <div class="flex items-center justify-center space-x-4 my-4 mx-auto">
          <img
            alt="React logo"
            src={svelteLogo}
            class="relative inline-block w-12"
          />
          <div class="text-3xl text-white">+</div>
          <img
            alt="TypeScript logo"
            src={typescriptLogo}
            class="relative inline-block w-12"
          />
          <div class="text-3xl text-white">+</div>
          <img
            alt="Tailwind logo"
            src={tailwindLogo}
            class="relative inline-block w-12"
          />
        </div>
        <h2 class="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          This is a content script running Svelte, TypeScript, and Tailwind.css
        </h2>
        <p class="mt-6 text-lg leading-8 text-gray-300">
          Learn more about creating cross-browser extensions by
          <button
            on:click={toggleDialog}
            class="underline hover:no-underline"
          >
            closing this hint
          </button>
          .
        </p>
      </div>
      <div class="relative mt-16 h-80 lg:mt-8">
        <img
          class="absolute left-0 top-0 w-[57rem] max-w-none rounded-md bg-white/5 ring-1 ring-white/10"
          src={chromeWindowBg}
          alt="Chrome window screenshot"
          width="1824"
          height="1080"
        />
      </div>
    </div>
  </div>
{/if}
