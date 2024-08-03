import tailwindBg from '../images/tailwind_bg.png'
import tailwindLogo from '../images/tailwind.png'
import chromeWindowBg from '../images/chromeWindow.png'

export function getContentHtml() {
  return `
    <div class="mx-auto max-w-7xl md:px-0 lg:p-6">
      <div class="relative isolate overflow-hidden bg-gray-900 px-6 pt-16 shadow-2xl lg:rounded-3xl md:pt-12 md:h-full sm:h-[100vh] lg:flex lg:gap-x-20 lg:px-12 lg:pt-0">
        <div class="absolute z-20 top-0 inset-x-0 flex justify-center overflow-hidden pointer-events-none">
          <div class="w-[108rem] flex-none flex justify-end">
            <picture>
              <img
                src=${tailwindBg}
                alt=""
                class="w-[90rem] flex-none max-w-none hidden dark:block"
                decoding="async"
              />
            </picture>
          </div>
        </div>
        <div class="mx-auto max-w-md text-center lg:py-12 lg:mx-0 lg:flex-auto lg:text-left">
          <div class="my-4">
            <img
              alt="Tailwind logo"
              src=${tailwindLogo}
              class="relative inline-block w-12"
            />
          </div>
          <h2 class="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            This is a content script running Tailwind.css.
          </h2>
        </div>
        <div class="relative mt-16 lg:mt-8">
          <img
            class="absolute left-0 top-0 w-[57rem] max-w-none rounded-md bg-white/5 ring-1 ring-white/10"
            src=${chromeWindowBg}
            alt="Chrome window screenshot"
            width="1824"
            height="1080"
          />
        </div>
      </div>
    </div>
  `
}
