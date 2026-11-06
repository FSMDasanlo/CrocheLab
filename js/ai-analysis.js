(function () {
  "use strict";

  const GEMINI_MODEL = "gemini-flash-latest";
  const MAX_PHOTOS = 4;
  const MAX_IMAGE_SIDE = 1280;
  const ANALYSIS_TIMEOUT_MS = 90000;
  const MAX_GEMINI_ATTEMPTS = 3;
  const SHAPES = ["triangle", "semicircle", "rectangle"];
  const CONFIDENCE = ["high", "medium", "low"];

  function isConfigured() {
    const key = window.APP_CONFIG && window.APP_CONFIG.geminiApiKey;
    return typeof key === "string" && Boolean(key.trim()) && !key.trim().startsWith("TU_");
  }

  function buildPrompt(stitchCatalog) {
    const list = stitchCatalog.map(function (stitch) { return stitch.id + " (" + stitch.name + ")"; }).join(", ");
    return [
      "Eres un experto en ganchillo. Analiza las fotografías de una misma prenda o pieza de ganchillo.",
      "Responde solo con el JSON pedido, en español.",
      "Indica el tipo de prenda y la silueta que mejor la describe: triangle, semicircle, rectangle u other.",
      "Lista únicamente los puntos que puedas ver con claridad usando exactamente estos identificadores: " + list + ".",
      "Para cada punto añade una confianza (high, medium o low) y una breve evidencia visual.",
      "Si algo no se distingue, no lo inventes: añádelo a 'uncertainties'.",
      "No afirmes cifras de puntos o vueltas que no puedas contar en las fotos.",
      'Formato: {"garment":"prenda","shape":"triangle|semicircle|rectangle|other","shapeConfidence":"high|medium|low","stitches":[{"id":"identificador","confidence":"high|medium|low","evidence":"evidencia"}],"uncertainties":["duda"]}.'
    ].join("\n");
  }

  function clampConfidence(value) {
    return CONFIDENCE.indexOf(value) >= 0 ? value : "low";
  }

  function text(value, limit) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }

  // Convierte la respuesta de la IA en una propuesta segura: descarta puntos desconocidos y formas no soportadas.
  function normalizeAnalysis(raw, validStitchIds) {
    const data = raw && typeof raw === "object" ? raw : {};
    const valid = new Set(validStitchIds);
    const seen = new Set();
    const stitches = [];
    const unrecognized = [];

    (Array.isArray(data.stitches) ? data.stitches : []).forEach(function (item) {
      const id = item && item.id;
      if (valid.has(id)) {
        if (seen.has(id)) return;
        seen.add(id);
        stitches.push({ id: id, confidence: clampConfidence(item.confidence), evidence: text(item.evidence, 200) });
      } else if (item && typeof item.id === "string") {
        unrecognized.push(item.id.slice(0, 60));
      }
    });

    const shape = SHAPES.indexOf(data.shape) >= 0 ? data.shape : null;
    return {
      garment: text(data.garment, 80),
      shape: shape,
      shapeConfidence: clampConfidence(data.shapeConfidence),
      stitches: stitches,
      unrecognizedStitches: unrecognized,
      uncertainties: (Array.isArray(data.uncertainties) ? data.uncertainties : [])
        .map(function (entry) { return text(entry, 200); })
        .filter(Boolean)
        .slice(0, 8)
    };
  }

  function blobToInlinePart(blob) {
    return new Promise(function (resolve, reject) {
      function fromBlob(source, mimeType) {
        try {
          const reader = new FileReader();
          reader.onerror = function () { reject(reader.error || new Error("No se pudo leer una fotografía.")); };
          reader.onabort = function () { reject(new Error("Se interrumpió la lectura de una fotografía.")); };
          reader.onload = function () {
            resolve({ inlineData: { mimeType: mimeType, data: String(reader.result).split(",")[1] } });
          };
          reader.readAsDataURL(source);
        } catch (error) {
          reject(error);
        }
      }

      if (typeof createImageBitmap !== "function") {
        fromBlob(blob, blob.type || "image/jpeg");
        return;
      }
      createImageBitmap(blob).then(function (bitmap) {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        canvas.toBlob(function (jpeg) {
          if (jpeg) fromBlob(jpeg, "image/jpeg");
          else fromBlob(blob, blob.type || "image/jpeg");
        }, "image/jpeg", 0.85);
      }).catch(function () { fromBlob(blob, blob.type || "image/jpeg"); });
    });
  }

  function waitForRetry(delay, signal) {
    return new Promise(function (resolve, reject) {
      if (signal.aborted) {
        reject(new Error("El análisis ha caducado."));
        return;
      }
      const timer = setTimeout(function () {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delay);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("El análisis ha caducado."));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function requestGemini(body, signal, onProgress) {
    function attempt(number) {
      if (signal.aborted) return Promise.reject(new Error("El análisis ha caducado."));
      if (onProgress) onProgress(number === 1 ? "requesting" : "retrying", number);
      return fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": window.APP_CONFIG.geminiApiKey.trim() },
        signal: signal,
        body: body
      }).catch(function (error) {
        if (error instanceof TypeError) {
          throw new Error("No se pudo conectar con Gemini. Comprueba tu conexión y vuelve a intentarlo.");
        }
        throw error;
      }).then(function (response) {
        if ([500, 502, 503, 504].indexOf(response.status) >= 0 && number < MAX_GEMINI_ATTEMPTS) {
          const delay = 1000 * Math.pow(2, number - 1) * (1 + Math.random() * 0.5);
          return waitForRetry(delay, signal).then(function () { return attempt(number + 1); });
        }
        return response;
      });
    }
    return attempt(1);
  }

  function analyzePhotos(blobs, stitchCatalog, onProgress) {
    if (!isConfigured()) {
      return Promise.reject(new Error("Falta la clave de Gemini en js/config.js."));
    }
    if (!blobs.length) return Promise.reject(new Error("El proyecto no tiene fotografías."));
    const validIds = stitchCatalog.map(function (stitch) { return stitch.id; });
    const controller = new AbortController();
    let timer;
    const timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        reject(new Error("El análisis ha tardado demasiado. Comprueba tu conexión e inténtalo de nuevo."));
        controller.abort();
      }, ANALYSIS_TIMEOUT_MS);
    });
    const analysis = Promise.resolve().then(function () {
      if (onProgress) onProgress("preparing");
      return Promise.all(blobs.slice(0, MAX_PHOTOS).map(blobToInlinePart));
    })
      .then(function (parts) {
        if (controller.signal.aborted) throw new Error("El análisis ha caducado.");
        const body = JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(stitchCatalog) }].concat(parts) }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
        });
        return requestGemini(body, controller.signal, onProgress);
      })
      .then(function (response) {
        if (!response.ok) {
          if (response.status === 429) throw new Error("Gemini ha alcanzado el límite de solicitudes. Espera un momento y vuelve a intentarlo.");
          if ([500, 502, 503, 504].indexOf(response.status) >= 0) {
            throw new Error("Gemini no está disponible en este momento (error " + response.status + "). Se ha intentado varias veces; vuelve a probar más tarde.");
          }
          if (response.status === 400 || response.status === 401 || response.status === 403) {
            throw new Error("Gemini ha rechazado la solicitud (error " + response.status + "). Comprueba la clave y los permisos de la API.");
          }
          throw new Error("Gemini ha respondido con el error " + response.status + ". Inténtalo de nuevo.");
        }
        return response.json();
      })
      .then(function (data) {
        const candidate = data.candidates && data.candidates[0];
        const parts = candidate && candidate.content && candidate.content.parts;
        if (!Array.isArray(parts)) {
          throw new Error("Gemini no devolvió un análisis. Revisa si bloqueó la respuesta.");
        }
        const content = parts.map(function (part) { return part.text || ""; }).join("");
        return normalizeAnalysis(JSON.parse(content), validIds);
      });
    return Promise.race([analysis, timeout]).finally(function () { clearTimeout(timer); });
  }

  window.CrocheLabAI = Object.freeze({
    isConfigured: isConfigured,
    analyzePhotos: analyzePhotos,
    normalizeAnalysis: normalizeAnalysis,
    buildPrompt: buildPrompt,
    maxPhotos: MAX_PHOTOS
  });
})();
