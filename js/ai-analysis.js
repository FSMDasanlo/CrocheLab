(function () {
  "use strict";

  const FIREBASE_VERSION = "12.0.0";
  const MAX_PHOTOS = 4;
  const MAX_IMAGE_SIDE = 1280;
  const SHAPES = ["triangle", "semicircle", "rectangle"];
  const CONFIDENCE = ["high", "medium", "low"];

  function isConfigured() {
    const config = window.CROCHELAB_FIREBASE_CONFIG;
    return Boolean(config && config.apiKey && config.projectId && config.appId);
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
      "No afirmes cifras de puntos o vueltas que no puedas contar en las fotos."
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
        const reader = new FileReader();
        reader.onerror = function () { reject(reader.error); };
        reader.onload = function () {
          resolve({ inlineData: { mimeType: mimeType, data: String(reader.result).split(",")[1] } });
        };
        reader.readAsDataURL(source);
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
        canvas.toBlob(function (jpeg) {
          if (jpeg) fromBlob(jpeg, "image/jpeg");
          else fromBlob(blob, blob.type || "image/jpeg");
        }, "image/jpeg", 0.85);
      }).catch(function () { fromBlob(blob, blob.type || "image/jpeg"); });
    });
  }

  let modelPromise = null;

  function loadModel() {
    if (modelPromise) return modelPromise;
    const base = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";
    modelPromise = Promise.all([import(base + "firebase-app.js"), import(base + "firebase-ai.js")]).then(function (modules) {
      const app = modules[0].initializeApp(window.CROCHELAB_FIREBASE_CONFIG);
      const ai = modules[1].getAI(app, { backend: new modules[1].GoogleAIBackend() });
      const Schema = modules[1].Schema;
      const responseSchema = Schema.object({
        properties: {
          garment: Schema.string(),
          shape: Schema.enumString({ enum: SHAPES.concat("other") }),
          shapeConfidence: Schema.enumString({ enum: CONFIDENCE }),
          stitches: Schema.array({
            items: Schema.object({
              properties: {
                id: Schema.string(),
                confidence: Schema.enumString({ enum: CONFIDENCE }),
                evidence: Schema.string()
              }
            })
          }),
          uncertainties: Schema.array({ items: Schema.string() })
        }
      });
      return modules[1].getGenerativeModel(ai, {
        model: window.CROCHELAB_AI_MODEL || "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema, temperature: 0.2 }
      });
    }).catch(function (error) {
      modelPromise = null;
      throw error;
    });
    return modelPromise;
  }

  function analyzePhotos(blobs, stitchCatalog) {
    if (!isConfigured()) {
      return Promise.reject(new Error("El análisis con IA no está configurado todavía."));
    }
    if (!blobs.length) return Promise.reject(new Error("El proyecto no tiene fotografías."));
    const validIds = stitchCatalog.map(function (stitch) { return stitch.id; });
    return Promise.all([loadModel(), Promise.all(blobs.slice(0, MAX_PHOTOS).map(blobToInlinePart))])
      .then(function (results) {
        return results[0].generateContent([buildPrompt(stitchCatalog)].concat(results[1]));
      })
      .then(function (response) {
        return normalizeAnalysis(JSON.parse(response.response.text()), validIds);
      });
  }

  window.CrocheLabAI = Object.freeze({
    isConfigured: isConfigured,
    analyzePhotos: analyzePhotos,
    normalizeAnalysis: normalizeAnalysis,
    buildPrompt: buildPrompt,
    maxPhotos: MAX_PHOTOS
  });
})();
