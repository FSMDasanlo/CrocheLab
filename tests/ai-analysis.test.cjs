const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const windowContext = {};
for (const file of ["firebase-config.js", "ai-analysis.js"]) {
  vm.runInNewContext(fs.readFileSync(path.join(root, "js", file), "utf8"), { window: windowContext });
}
const ai = windowContext.CrocheLabAI;

test("analysis is disabled while the Firebase config is empty", async function () {
  assert.equal(ai.isConfigured(), false);
  await assert.rejects(ai.analyzePhotos([{}], [{ id: "chain", name: "Cadeneta" }]));
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
