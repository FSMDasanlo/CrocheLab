(function () {
  "use strict";

  const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
  const MAX_PHOTOS = 4;
  const MAX_IMAGE_SIDE = 1280;
  const ANALYSIS_TIMEOUT_MS = 90000;
  const MAX_GEMINI_ATTEMPTS = 3;
  const SHAPES = ["triangle", "semicircle", "rectangle", "border"];
  const CONFIDENCE = ["high", "medium", "low"];

  function getGeminiModel() {
    const custom = window.APP_CONFIG && window.APP_CONFIG.geminiModel;
    return typeof custom === "string" && custom.trim() ? custom.trim() : DEFAULT_GEMINI_MODEL;
  }

  function isConfigured() {
    const key = window.APP_CONFIG && window.APP_CONFIG.geminiApiKey;
    return typeof key === "string" && Boolean(key.trim()) && !key.trim().startsWith("TU_");
  }

  function buildPrompt(stitchCatalog) {
    const list = stitchCatalog.map(function (stitch) { return stitch.id + " (" + stitch.name + ")"; }).join(", ");
    return [
      "Eres un experto en ganchillo y lectura de diagramas técnicos de croché.",
      "Analiza las fotografías de una misma prenda, muestra o pieza de ganchillo.",
      "Responde solo con el JSON pedido, en español.",
      "Determina la silueta o tipo de pieza que mejor la describe:",
      "- 'border': si es una puntilla, orilla, cenefa, borde o motivo festoneado con abanicos/ondas.",
      "- 'triangle': si es un chal triangular o pieza en pico.",
      "- 'semicircle': si es un chal semicircular o en media luna.",
      "- 'rectangle': si es un chal rectangular, bufanda o manta recta.",
      "- 'other': si tiene otra forma no clasificable en las anteriores.",
      "Lista únicamente los puntos del catálogo que puedas ver con claridad usando exactamente estos identificadores: " + list + ".",
      "Presta especial atención si identificas abanicos (fan), puntos altos (double-crochet), cadenetas (chain), puntos bajos (single-crochet) o picots (picot).",
      "Para cada punto añade una confianza (high, medium o low) y una breve evidencia visual.",
      "Si algo no se distingue, no lo inventes: añádelo a 'uncertainties'.",
      "No afirmes cifras de puntos o vueltas que no puedas contar en las fotos.",
      'Formato: {"garment":"prenda o pieza","shape":"triangle|semicircle|rectangle|border|other","shapeConfidence":"high|medium|low","stitches":[{"id":"identificador","confidence":"high|medium|low","evidence":"evidencia"}],"uncertainties":["duda"]}.'
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

  function blobToInlinePart(blob, maxSide) {
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
        const scale = Math.min(1, (maxSide || MAX_IMAGE_SIDE) / Math.max(bitmap.width, bitmap.height));
        if (maxSide && scale === 1) {
          bitmap.close();
          fromBlob(blob, blob.type || "image/jpeg");
          return;
        }
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
      return fetch("https://generativelanguage.googleapis.com/v1beta/models/" + getGeminiModel() + ":generateContent", {
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

  function normalizeReconstructionFindings(raw, photoId) {
    const categories = ["shape", "orientation", "symmetry", "motif", "stitch", "border", "repeat", "join", "row_change", "other"];
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.findings) || !raw.findings.length) {
      throw new Error("La respuesta no contiene una lista de hallazgos.");
    }
    return raw.findings.map(function (finding) {
      if (!finding || !["observation", "inference", "unknown"].includes(finding.kind) ||
          !categories.includes(finding.category) || typeof finding.statement !== "string" ||
          !finding.statement.trim() || !["high", "medium", "low", "unknown"].includes(finding.confidence) ||
          !Object.prototype.hasOwnProperty.call(finding, "region")) {
        throw new Error("La respuesta contiene un hallazgo incompleto o incompatible.");
      }
      const region = finding.region;
      if (region !== null && (!region || typeof region !== "object" ||
          !["x", "y", "width", "height"].every(function (key) { return Number.isFinite(region[key]); }) ||
          region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
          region.x + region.width > 1 || region.y + region.height > 1)) {
        throw new Error("La respuesta contiene una región de fotografía inválida.");
      }
      return {
        kind: finding.kind,
        category: finding.category,
        statement: finding.statement.trim(),
        confidence: finding.confidence,
        photoId: photoId,
        region: region === null ? null : { x: region.x, y: region.y, width: region.width, height: region.height }
      };
    });
  }

  function reconstructionPrompt(role) {
    return [
      "Analiza una fotografía de una pieza de croché para una reconstrucción revisada por una persona.",
      "Función declarada de la fotografía: " + role + ". Responde solo JSON en español.",
      "Describe por separado observaciones visibles, inferencias y datos desconocidos.",
      "Considera silueta, orientación, simetría, motivos, puntos, bordes, repeticiones, uniones y cambios entre filas.",
      "Cuando sean visibles, describe el orden de los puntos dentro del motivo, sus anclajes, los grupos de cadenetas y las cantidades que puedas contar; indica si cada dato se ve o se deduce.",
      "No inventes cantidades ni secuencias. Si no se ven claramente, declara una incógnita.",
      "Cada hallazgo debe describir solo lo justificable con esta fotografía; no propongas un patrón completo.",
      "La región es null si no puedes localizarla; si puedes, usa coordenadas normalizadas entre 0 y 1.",
      'Formato: {"findings":[{"kind":"observation|inference|unknown","category":"shape|orientation|symmetry|motif|stitch|border|repeat|join|row_change|other","statement":"texto","confidence":"high|medium|low|unknown","region":null}]}'
    ].join("\n");
  }

  async function analyzeReconstructionPhoto(photo, onProgress) {
    if (!isConfigured()) throw new Error("El análisis visual no está disponible.");
    if (!photo || typeof photo.id !== "string" || !photo.id || !(photo.blob instanceof Blob) ||
        !["overview", "detail", "border", "repeat", "join", "other"].includes(photo.role)) {
      throw new Error("La fotografía o su función no son válidas.");
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        reject(new Error("El análisis de la fotografía ha caducado."));
        controller.abort();
      }, ANALYSIS_TIMEOUT_MS);
    });
    const analysis = Promise.resolve().then(function () {
      if (onProgress) onProgress("preparing");
      return blobToInlinePart(photo.blob, 2048);
    }).then(function (part) {
      if (controller.signal.aborted) throw new Error("El análisis de la fotografía ha caducado.");
      return requestGemini(JSON.stringify({
        contents: [{ parts: [{ text: reconstructionPrompt(photo.role) }, part] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      }), controller.signal, onProgress);
    }).then(function (response) {
      if (!response.ok) throw new Error("El análisis visual ha fallado (HTTP " + response.status + ").");
      return response.json();
    }).then(function (data) {
      const candidate = data.candidates && data.candidates[0];
      const parts = candidate && candidate.content && candidate.content.parts;
      if (!Array.isArray(parts)) throw new Error("El servicio no devolvió un análisis de esta fotografía.");
      return normalizeReconstructionFindings(JSON.parse(parts.map(function (part) { return part.text || ""; }).join("")), photo.id);
    });
    return Promise.race([analysis, timeout]).finally(function () { clearTimeout(timer); });
  }

  async function proposeReconstruction(findings, previousDiagnostics) {
    if (!isConfigured()) throw new Error("El análisis visual no está disponible.");
    if (!Array.isArray(findings) || !findings.length) throw new Error("No hay hallazgos visuales para construir una propuesta.");
    const prompt = [
      "Construye una propuesta de croché exclusivamente a partir de los hallazgos proporcionados.",
      "No inventes cantidades ni relaciones sin indicios. Identifica las inferencias y desconocidos. No escribas instrucciones ni dibujes.",
      "Devuelve JSON: {document, claims, assumptions, unknowns, complete}. document es null si no puedes construir nada.",
      "complete es true solo si la construcción cubre toda la pieza desde el inicio hasta la terminación; si solo se conocen fragmentos, es false.",
      "claims es una lista de {path, findingIds, confidence} para cada operación de fila, salvo turn y space. path es fila/operación y findingIds contiene IDs de hallazgos que la justifican. confidence es high, medium o low.",
      "assumptions y unknowns son listas de textos. Una interpretación no es una confirmación humana.",
      "El documento solo permite filas de ida y vuelta. Usa IDs alfanuméricos que empiezan por letra y referencias separadas por /.",
      "document contiene schemaVersion='1.0.0', id, revision={id,parentId:null,change:null}, conventions={rowCountStitchTypes,rowCountChainRoles}, initial={direction,anchors,frontier,activeLoop}, motifs y rows.",
      "direction es right_to_left o left_to_right. Cada anclaje inicial tiene id y kind (stitch,chain,space,edge). La frontera es lista de referencias initial/ID. El bucle activo es {id,origin:{kind:'attached_to',anchor:'initial/ID'}} o null si se desconoce.",
      "Cada fila contiene id,direction,operations y nextPass={export,carry,skip,order}. order es reverse o same. El giro entre filas es una operación {id,type:'turn'}. Las entradas no usadas deben figurar en carry o skip, sin inventar su estado.",
      "Operaciones: {id,type:'sc'|'hdc'|'dc'|'tr',target:{ref:'fila/operacion/top'}}; {id,type:'chain',chainIds:{tokens:[IDs]},role:'foundation'|'turning'|'space_boundary'|'decorative'}; {id,type:'slip',target:{ref},reuse:'none'}; {id,type:'increase',target:{ref},stitchType:'sc'|'hdc'|'dc'|'tr',stitchIds:{tokens:[IDs]}}; {id,type:'decrease',targets:[{ref},{ref}],technique:'sc2tog'}; {id,type:'space',chainId,closureId}; {id,type:'unknown',reason}.",
      "Para desconocidos usa {unknown:'explicación'} en target o chainIds, o una operación unknown; no sustituyas por cifras supuestas.",
      "Un punto produce fila/operacion/top; cada eslabón produce fila/operacion/ID/anchor; aumento produce fila/operacion/ID/top. export admite sc.top,hdc.top,dc.top,tr.top,sc2tog.top,slip.top,chain.anchor,space.anchor.",
      "Un motivo se define en motifs como {id,version,parameters,operations}, donde parameters asigna 'anchor' o 'tokens' a cada nombre y sus operaciones primitivas pueden usar {param:'nombre'}.",
      "Una instancia usa {id,type:'motif',definitionId,definitionVersion,bindings}. Una repetición usa {id,type:'repeat',iterations:[{id,bindings,overrides:{}}],operations:[instancias o primitivas]}. En un motivo, un deslizado que cierra una cadena en el mismo anclaje puede usar reuse:'motif_closure'.",
      "No incluyas técnicas no soportadas. Si no puedes definir una construcción lógica, document=null y explica por qué en unknowns.",
      "Las fotografías se examinaron individualmente. No atribuyas a una foto datos ausentes de su hallazgo.",
      "Hallazgos: " + JSON.stringify(findings),
      previousDiagnostics && previousDiagnostics.length ? "Corrige solo errores estructurales de la propuesta anterior, sin inventar datos: " + JSON.stringify(previousDiagnostics) : ""
    ].join("\n");
    const controller = new AbortController();
    let timer;
    const timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { controller.abort(); reject(new Error("La construcción automática ha caducado.")); }, ANALYSIS_TIMEOUT_MS);
    });
    const request = requestGemini(JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    }), controller.signal).then(function (response) {
      if (!response.ok) throw new Error("No se pudo construir la propuesta (HTTP " + response.status + ").");
      return response.json();
    }).then(function (data) {
      const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      if (!Array.isArray(parts)) throw new Error("El servicio no devolvió una construcción.");
      return JSON.parse(parts.map(function (part) { return part.text || ""; }).join(""));
    });
    return Promise.race([request, timeout]).finally(function () { clearTimeout(timer); });
  }

  window.CrocheLabAI = Object.freeze({
    isConfigured: isConfigured,
    analyzePhotos: analyzePhotos,
    normalizeAnalysis: normalizeAnalysis,
    buildPrompt: buildPrompt,
    analyzeReconstructionPhoto: analyzeReconstructionPhoto,
    proposeReconstruction: proposeReconstruction,
    normalizeReconstructionFindings: normalizeReconstructionFindings,
    maxPhotos: MAX_PHOTOS
  });
})();
