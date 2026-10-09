<template>
  <router-view />
  <SkinLayoutEditor />
</template>

<script setup lang="ts">
import SkinLayoutEditor from "./components/SkinLayoutEditor.vue";
</script>

<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
button, input { font: inherit; }
button { border: 0; }

:root {
  --ui-scale: 1;
}

/* Scale the complete application from the 1920×1080 reference viewport so
   typography, spacing, controls, and icons grow together instead of drifting
   apart when the browser has a high-resolution viewport. */
#app {
  zoom: var(--ui-scale);
}
</style>
