<template>
  <svg
    class="ui-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-if="name === 'home'" d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    <path v-else-if="name === 'activity'" d="M3 12h4l2.2-7 4.1 14 2.2-7H21" />
    <template v-else-if="name === 'server'">
      <rect x="4" y="3" width="16" height="7" rx="1.5" />
      <rect x="4" y="14" width="16" height="7" rx="1.5" />
      <path d="M8 6.5h.01M8 17.5h.01M11 6.5h5M11 17.5h5" />
    </template>
    <template v-else-if="name === 'compass'">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19v2h16v-2" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0L6.2 6.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <path v-else-if="name === 'mic'" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0m-7 7v3m-3 0h6" />
    <path v-else-if="name === 'mic-off'" d="m4 4 16 16M10 6v5a2 2 0 0 0 3.2 1.6M14 6V5a2 2 0 0 0-3.7-1M5 11a7 7 0 0 0 10.6 6m3.4-6a7 7 0 0 0-.5-2.5M12 18v3m-3 0h6" />
    <template v-else-if="name === 'music'">
      <path d="M9 18V5l10-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </template>
    <path v-else-if="name === 'headset'" d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1zm16 0h-3v5h2a1 1 0 0 1-1-1z" />
    <path v-else-if="name === 'volume'" d="M4 10v4h3l4 3V7l-4 3zm10.5-2.5a6 6 0 0 1 0 9m2-11a9 9 0 0 1 0 13" />
    <path v-else-if="name === 'volume-off'" d="m4 4 16 16M4 10v4h3l4 3V7l-4 3z" />
    <template v-else-if="name === 'search'">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </template>
    <path v-else-if="name === 'bell'" d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    <path v-else-if="name === 'clock'" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2" />
    <path v-else-if="name === 'help'" d="M9.3 9a3 3 0 1 1 4.9 2.3c-1.3 1-2.2 1.5-2.2 3m0 3h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6m0-9h.01" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <path v-else-if="name === 'chevron-down'" d="m6 9 6 6 6-6" />
    <path v-else-if="name === 'chevron-right'" d="m9 6 6 6-6 6" />
    <path v-else-if="name === 'hash'" d="M9 3 7 21M17 3l-2 18M4 9h16M3 15h16" />
    <path v-else-if="name === 'send'" d="m21 3-7.4 18-3.6-7-7-3.6zM21 3 10 14" />
    <template v-else-if="name === 'smile'">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </template>
    <path v-else-if="name === 'paperclip'" d="m20 11-7.5 7.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-7.5 7.5a2 2 0 0 1-3-3L14 7" />
    <path v-else-if="name === 'share'" d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4m4-4v13" />
    <path v-else-if="name === 'copy'" d="M8 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3M6 8h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
    <path v-else-if="name === 'close'" d="m6 6 12 12M18 6 6 18" />
    <path v-else-if="name === 'more'" d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3" />
    <path v-else-if="name === 'refresh'" d="M20 11a8 8 0 0 0-14-4L4 9m0-4v4h4M4 13a8 8 0 0 0 14 4l2-2m0 4v-4h-4" />
    <path v-else-if="name === 'lock'" d="M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3" />
    <path v-else-if="name === 'users'" d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-7a4 4 0 0 1 0 7m2 5h1a4 4 0 0 1 4 4v1" />
    <path v-else-if="name === 'message'" d="M20 11.5a7.5 7.5 0 0 1-8 7.5 9.4 9.4 0 0 1-3-.5L4 20l1.5-3.6A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" />
    <path v-else-if="name === 'door'" d="M10 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5m5 14 5-5-5-5m5 5H9" />
    <path v-else-if="name === 'waveform'" d="M3 12h2l2-6 3 12 3-9 2 6h6" />
    <path v-else-if="name === 'shield'" d="M12 21s8-3.5 8-10V5l-8-3-8 3v6c0 6.5 8 10 8 10Z" />
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </template>
    <path v-else-if="name === 'moon'" d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z" />
    <path v-else-if="name === 'monitor'" d="M4 4h16v12H4zM8 20h8M12 16v4" />
    <path v-else-if="name === 'github'" fill="currentColor" stroke="none" d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.73-1.52-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.03 0 0 .96-.31 3.15 1.17.91-.25 1.88-.38 2.85-.38.97 0 1.94.13 2.85.38 2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.74.11 3.03.73.8 1.18 1.82 1.18 3.07 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.04.78 2.1 0 1.52-.01 2.75-.01 3.12 0 .3.21.67.8.56C20.71 21.39 24 17.08 24 12 24 5.65 18.35.5 12 .5Z" />
    <path v-else-if="name === 'check'" d="m5 12 4 4L19 6" />
    <circle v-else cx="12" cy="12" r="8" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
</script>

<style scoped>
.ui-icon {
  display: block;
  flex: 0 0 auto;
}
</style>
