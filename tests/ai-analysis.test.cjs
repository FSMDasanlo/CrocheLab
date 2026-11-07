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

test("analysis is disabled until a Gemini API key is configured", async function () {
  assert.equal(ai.isConfigured(), false);
  await assert.rejects(ai.analyzePhotos([{}], [{ id: "chain", name: "Cadeneta" }]));
  windowContext.APP_CONFIG = { geminiApiKey: "TU_GEMINI_API_KEY" };
  assert.equal(ai.isConfigured(), false);
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
  assert.equal(ai.isConfigured(), true);
});

test("sends up to four photos directly to Gemini and normalizes its JSON response", async function () {
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
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
  assert.match(request.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-flash-latest:generateContent$/);
  assert.equal(request.options.headers["x-goog-api-key"], "test-key");
  assert.equal(payload.contents[0].parts.length, 5);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(payload.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(phases, ["preparing", "requesting"]);
  assert.equal(result.garment, "Chal");
  assert.equal(result.stitches[0].id, "chain");
});

test("reports errors from Gemini instead of returning an empty analysis", async function () {
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
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
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
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
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
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
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
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
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
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
  windowContext.APP_CONFIG = { geminiApiKey: "test-key" };
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

test("uses custom geminiModel from APP_CONFIG when provided", async function () {
  windowContext.APP_CONFIG = { geminiApiKey: "test-key", geminiModel: "gemini-3.5-flash-lite" };
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
  assert.match(requestedUrl, /models\/gemini-3\.5-flash-lite:generateContent$/);
});

