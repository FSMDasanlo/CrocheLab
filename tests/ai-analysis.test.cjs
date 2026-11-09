const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const windowContext = {};
let fetchImpl;
let timeoutCallback;
let retryTimers = [];
let useFakeTimeout = false;
let pendingReader;
class TestFileReader {
  readAsDataURL(blob) {
    this.result = "data:" + blob.type + ";base64," + blob.data;
    if (blob.pending) {
      pendingReader = this;
      return;
    }
    this.onload();
  }
}
vm.runInNewContext(fs.readFileSync(path.join(root, "js", "ai-analysis.js"), "utf8"), {
  window: windowContext,
  FileReader: TestFileReader,
  AbortController: AbortController,
  TypeError: TypeError,
  setTimeout: function (callback, delay) {
    if (useFakeTimeout) {
      if (delay === 90000) {
        timeoutCallback = callback;
        return "timeout";
      }
      const timer = { callback: callback, delay: delay, cleared: false };
      retryTimers.push(timer);
      return timer;
    }
    return setTimeout(callback, delay);
  },
  clearTimeout: function (timer) {
    if (!useFakeTimeout) clearTimeout(timer);
    else if (typeof timer === "object") timer.cleared = true;
  },
  fetch: function () { return fetchImpl.apply(null, arguments); }
});
const ai = windowContext.CrocheLabAI;

// Simula el backend de js/firebase-ai.mjs: traduce respuestas HTTP simuladas a la interfaz del SDK.
function installBackend() {
  windowContext.CrocheLabGemini = {
    generateContent: async function (model, request, signal) {
      const response = await fetchImpl("sdk:" + model, { body: JSON.stringify(request), signal: signal });
      if (!response.ok) {
        const error = new Error("HTTP " + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }
  };
}

test("reconstruction findings retain the photo reference and reject fabricated or malformed structure", function () {
  const entry = { kind: "observation", category: "stitch", statement: "Punto visible", confidence: "medium",
    region: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 } };
  const result = ai.normalizeReconstructionFindings({ findings: [entry] }, "photo-5");
  assert.equal(result[0].photoId, "photo-5");
  assert.equal(result[0].region.width, 0.4);
  assert.throws(() => ai.normalizeReconstructionFindings({ findings: [] }, "photo"), /hallazgos/);
  assert.throws(() => ai.normalizeReconstructionFindings({ findings: [{ ...entry, kind: "invented" }] }, "photo"), /incompatible/);
  assert.throws(() => ai.normalizeReconstructionFindings({ findings: [{ ...entry, region: { x: 0.9, y: 0, width: 0.2, height: 1 } }] }, "photo"), /región/);
});

test("automatic synthesis submits findings and expects a structured construction", async function () {
  installBackend();
  let body;
  fetchImpl = function (url, options) {
    body = JSON.parse(options.body);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ candidates: [{ content: { parts: [
      { text: JSON.stringify({ document: null, claims: [], assumptions: [], unknowns: ["No se ve el inicio"], complete: false }) }
    ] } }] }) });
  };
  const result = await ai.proposeReconstruction([{ id: "f1", photoId: "p1", kind: "unknown", statement: "Inicio oculto" }], []);
  assert.equal(result.document, null);
  assert.equal(result.unknowns[0], "No se ve el inicio");
  assert.match(body.contents[0].parts[0].text, /Inicio oculto/);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  delete windowContext.CrocheLabGemini;
});

test("analysis is disabled until the Firebase AI Logic backend is registered", async function () {
  assert.equal(ai.isConfigured(), false);
  await assert.rejects(ai.analyzePhotos([{}], [{ id: "chain", name: "Cadeneta" }]));
  installBackend();
  assert.equal(ai.isConfigured(), true);
});

test("sends up to four photos directly to Gemini and normalizes its JSON response", async function () {
  installBackend();
  let request;
  fetchImpl = function (url, options) {
    request = { url: url, options: options };
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          garment: "Chal",
          shape: "triangle",
          shapeConfidence: "high",
          stitches: [{ id: "chain", confidence: "high", evidence: "Bucles" }],
          uncertainties: []
        }) }] } }] });
      }
    });
  };
  const photos = Array.from({ length: 5 }, function () { return { type: "image/png", data: "Zm90bw==" }; });
  const phases = [];
  const result = await ai.analyzePhotos(photos, [{ id: "chain", name: "Cadeneta" }], function (phase) { phases.push(phase); });
  const payload = JSON.parse(request.options.body);
  assert.equal(request.url, "sdk:gemini-3.5-flash-lite");
  assert.equal(JSON.stringify(request).includes("key"), false);
  assert.equal(payload.contents[0].parts.length, 5);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(payload.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(phases, ["preparing", "requesting"]);
  assert.equal(result.garment, "Chal");
  assert.equal(result.stitches[0].id, "chain");
});

test("reports errors from Gemini instead of returning an empty analysis", async function () {
  installBackend();
  let requests = 0;
  fetchImpl = function () {
    requests += 1;
    return Promise.resolve({ ok: false, status: 403, text: function () { return Promise.resolve("Access denied"); } });
  };
  await assert.rejects(ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==" }], []), /Gemini ha rechazado la solicitud \(error 403\)/);
  assert.equal(requests, 1);
  fetchImpl = function () {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ candidates: [] }); } });
  };
  await assert.rejects(ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==" }], []), /Gemini no devolvió un análisis/);
  fetchImpl = function () { return Promise.reject(new TypeError("Failed to fetch")); };
  await assert.rejects(ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==" }], []), /No se pudo conectar con Gemini/);
});

test("retries a temporary 503 and returns the successful response", async function () {
  installBackend();
  useFakeTimeout = true;
  retryTimers = [];
  let requests = 0;
  const phases = [];
  fetchImpl = function () {
    requests += 1;
    if (requests === 1) return Promise.resolve({ ok: false, status: 503 });
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"garment":"Chal"}' }] } }] }); }
    });
  };
  try {
    const result = ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==" }], [], function (phase) { phases.push(phase); });
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(requests, 1);
    assert.ok(retryTimers[0].delay >= 1000 && retryTimers[0].delay <= 1500);
    retryTimers[0].callback();
    assert.equal((await result).garment, "Chal");
    assert.equal(requests, 2);
    assert.deepEqual(phases, ["preparing", "requesting", "retrying"]);
  } finally {
    useFakeTimeout = false;
  }
});

test("stops after three unavailable responses with a clear error", async function () {
  installBackend();
  useFakeTimeout = true;
  retryTimers = [];
  let requests = 0;
  fetchImpl = function () {
    requests += 1;
    return Promise.resolve({ ok: false, status: 503 });
  };
  try {
    const result = ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==" }], []);
    await new Promise(function (resolve) { setImmediate(resolve); });
    retryTimers[0].callback();
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.ok(retryTimers[1].delay >= 2000 && retryTimers[1].delay <= 3000);
    retryTimers[1].callback();
    await assert.rejects(result, /Gemini no está disponible.*error 503/);
    assert.equal(requests, 3);
  } finally {
    useFakeTimeout = false;
  }
});

test("timeout cancels a pending retry", async function () {
  installBackend();
  useFakeTimeout = true;
  retryTimers = [];
  let requests = 0;
  fetchImpl = function () {
    requests += 1;
    return Promise.resolve({ ok: false, status: 503 });
  };
  try {
    const result = ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==" }], []);
    await new Promise(function (resolve) { setImmediate(resolve); });
    timeoutCallback();
    await assert.rejects(result, /ha tardado demasiado/);
    assert.equal(retryTimers[0].cleared, true);
    assert.equal(requests, 1);
  } finally {
    useFakeTimeout = false;
  }
});

test("times out and aborts a Gemini request that does not respond", async function () {
  installBackend();
  useFakeTimeout = true;
  let signal;
  fetchImpl = function (url, options) {
    signal = options.signal;
    return new Promise(function () {});
  };
  try {
    const result = ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==" }], []);
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.ok(signal);
    timeoutCallback();
    await assert.rejects(result, /ha tardado demasiado/);
    assert.equal(signal.aborted, true);
  } finally {
    useFakeTimeout = false;
  }
});

test("does not send photos if their preparation completes after the timeout", async function () {
  installBackend();
  useFakeTimeout = true;
  let requests = 0;
  fetchImpl = function () { requests += 1; };
  try {
    const result = ai.analyzePhotos([{ type: "image/jpeg", data: "Zm90bw==", pending: true }], []);
    await new Promise(function (resolve) { setImmediate(resolve); });
    timeoutCallback();
    await assert.rejects(result, /ha tardado demasiado/);
    pendingReader.onload();
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(requests, 0);
  } finally {
    useFakeTimeout = false;
    pendingReader = null;
  }
});

test("normalizeAnalysis drops unknown stitches, duplicates and bad values", function () {
  const result = ai.normalizeAnalysis({
    garment: "Chal",
    shape: "hexagon",
    shapeConfidence: "certain",
    stitches: [
      { id: "chain", confidence: "high", evidence: "arcos" },
      { id: "chain", confidence: "low" },
      { id: "magic-loop", confidence: "high" },
      { id: "double-crochet", confidence: "bogus" }
    ],
    uncertainties: ["borde", 5]
  }, ["chain", "double-crochet"]);

  assert.equal(result.shape, null);
  assert.equal(result.shapeConfidence, "low");
  assert.equal(JSON.stringify(result.stitches.map(function (s) { return s.id + ":" + s.confidence; })), JSON.stringify(["chain:high", "double-crochet:low"]));
  assert.equal(JSON.stringify(result.unrecognizedStitches), JSON.stringify(["magic-loop"]));
  assert.equal(JSON.stringify(result.uncertainties), JSON.stringify(["borde"]));
});

test("normalizeAnalysis tolerates garbage input", function () {
  const result = ai.normalizeAnalysis(null, ["chain"]);
  assert.equal(result.stitches.length, 0);
  assert.equal(result.shape, null);
});

test("normalizeAnalysis accepts border shape for edgings and puntillas", function () {
  const result = ai.normalizeAnalysis({
    garment: "Puntilla de 3 capuchones",
    shape: "border",
    shapeConfidence: "high",
    stitches: [
      { id: "chain", confidence: "high", evidence: "arcos de cadeneta" },
      { id: "double-crochet", confidence: "high", evidence: "abanicos de varetas" },
      { id: "picot", confidence: "high", evidence: "picots en la cúspide" }
    ],
    uncertainties: []
  }, ["chain", "double-crochet", "picot"]);

  assert.equal(result.shape, "border");
  assert.equal(result.shapeConfidence, "high");
  assert.equal(result.stitches.length, 3);
});

test("uses the configured default model through the Firebase AI Logic backend", async function () {
  installBackend();
  let requestedUrl = "";
  fetchImpl = function (url) {
    requestedUrl = url;
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ garment: "Gorro", stitches: [] }) }] } }]
        });
      }
    });
  };
  await ai.analyzePhotos([{ type: "image/png", data: "Zm90bw==" }], []);
  assert.equal(requestedUrl, "sdk:gemini-3.5-flash-lite");
});
