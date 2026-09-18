import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import WebClient from "./views/WebClient.vue";
import AdminView from "./views/AdminView.vue";
import DemoView from "./views/DemoView.vue";
import "./services/theme.js";

const BASELINE_WIDTH = 1920;
const BASELINE_HEIGHT = 1080;
const MAX_UI_SCALE = 1.5;

function applyUiScale(): void {
  // Keep the current 1080p layout as the reference. Only enlarge the UI when
  // both viewport dimensions provide more space; smaller windows keep the
  // existing responsive rules instead of shrinking text until it becomes hard
  // to read.
  const scale = Math.min(
    MAX_UI_SCALE,
    Math.max(1, Math.min(window.innerWidth / BASELINE_WIDTH, window.innerHeight / BASELINE_HEIGHT)),
  );
  document.documentElement.style.setProperty("--ui-scale", scale.toFixed(4));
}

applyUiScale();
window.addEventListener("resize", applyUiScale, { passive: true });

const routes = [
  { path: "/", name: "webclient", component: WebClient },
  { path: "/join", name: "join", component: WebClient },
  { path: "/demo", name: "demo", component: DemoView },
  { path: "/admin/:pathMatch(.*)*", name: "admin", component: AdminView },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
