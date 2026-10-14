import App from "./App.vue";
import router from "./router";
import { createApp } from "vue";
import mitt from "mitt";
import { initializeAuth } from "./auth";

import "./assets/styles.scss";
import "bootstrap-icons/font/bootstrap-icons.scss";
import "bootstrap";
import "vue-css-donut-chart/src/styles/main.css";

const app = createApp(App);

// Global event bus used to subscribe to websocket events
// such as message deletes, updates & truncation.
const eventBus = mitt();
app.provide("eventBus", eventBus);

app.use(router);
initializeAuth().then((ready) => {
	if (ready) app.mount("#app");
}).catch(() => {
	const warning = document.createElement("p");
	warning.className = "alert alert-danger m-3";
	warning.textContent = "Não foi possível abrir o Mailpit Cloudflare. Recarregue a página para tentar novamente.";
	document.getElementById("app").append(warning);
});
