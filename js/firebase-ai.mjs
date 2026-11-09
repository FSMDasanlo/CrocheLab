import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-ai.js";

// Gemini se consume a través de Firebase AI Logic: la clave se guarda en Firebase y
// App Check garantiza que solo esta aplicación pueda usarla. Sin reCAPTCHA configurado
// no se registra el backend y el análisis con IA queda desactivado (falla cerrado).
const config = window.CROCHELAB_FIREBASE_CONFIG;
const siteKey = window.CROCHELAB_APPCHECK_SITE_KEY;
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

function register() {
  if (!config || !config.projectId || typeof siteKey !== "string" || !siteKey.trim()) return;
  // En local App Check usa un token de depuración que se muestra en la consola del
  // navegador y debe registrarse una vez en Firebase Console > App Check.
  if (isLocal) self.FIREBASE_APPCHECK_DEBUG_TOKEN = window.CROCHELAB_APPCHECK_DEBUG_TOKEN || true;

  const app = initializeApp(config, "crochelab-ai");
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey.trim()), isTokenAutoRefreshEnabled: true });
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const models = new Map();

  window.CrocheLabGemini = {
    async generateContent(modelName, request, signal) {
      if (!models.has(modelName)) models.set(modelName, getGenerativeModel(ai, { model: modelName }));
      try {
        const result = await models.get(modelName).generateContent(request, signal ? { signal } : undefined);
        return { candidates: result.response.candidates || [] };
      } catch (error) {
        const wrapped = new Error(error && error.message ? error.message : "Error de Firebase AI Logic");
        wrapped.status = error && error.customErrorData ? error.customErrorData.status : undefined;
        wrapped.network = wrapped.status === undefined && Boolean(error && error.code && String(error.code).endsWith("fetch-error"));
        if (error && error.name === "AbortError") throw error;
        throw wrapped;
      }
    }
  };
}

try {
  register();
} catch (error) {
  console.error("No se pudo inicializar Firebase AI Logic:", error);
}
