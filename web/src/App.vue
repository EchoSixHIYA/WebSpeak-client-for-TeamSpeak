<template>
  <router-view />
</template>

<style>
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
