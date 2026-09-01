import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import WebClient from "./views/WebClient.vue";
import AdminView from "./views/AdminView.vue";

const routes = [
  { path: "/", name: "webclient", component: WebClient },
  { path: "/join", name: "join", component: WebClient },
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
