// Pega aquí la configuración web de tu app de Firebase (Consola de Firebase > Configuración del proyecto > Tus apps).
// Mientras apiKey esté vacío, el análisis con IA permanece desactivado y el resto de la app funciona igual.
window.CROCHELAB_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Modelo de Gemini usado por Firebase AI Logic.
window.CROCHELAB_AI_MODEL = "gemini-2.5-flash";
