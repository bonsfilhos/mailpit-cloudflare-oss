import axios from "axios";
import { reactive } from "vue";

export const browserAuth = reactive({ enabled: false, csrf: null, expiresAt: null });
let redirecting = false;

export function returnToLogin() {
  if (redirecting) return;
  redirecting = true;
  window.location.replace(`/login?return=${encodeURIComponent(location.pathname + location.search)}`);
}

export async function initializeAuth() {
  const response = await fetch("/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) { returnToLogin(); return false; }
  if (!response.ok) throw new Error("Não foi possível validar a sessão do Mailpit Cloudflare.");
  Object.assign(browserAuth, await response.json());
  if (browserAuth.expiresAt) {
    setTimeout(returnToLogin, Math.max(0, browserAuth.expiresAt * 1000 - Date.now()));
  }
  axios.interceptors.request.use((config) => {
    const target = new URL(config.url, location.origin);
    if (browserAuth.csrf && target.origin === location.origin && target.pathname.startsWith("/api/")) {
      config.headers.set("X-Mailpit Cloudflare-CSRF", browserAuth.csrf);
    }
    return config;
  });
  axios.interceptors.response.use((response) => response, (error) => {
    if (error.response?.status === 401) returnToLogin();
    return Promise.reject(error);
  });
  return true;
}
