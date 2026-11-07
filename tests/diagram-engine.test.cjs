const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const windowContext = {};

vm.runInNewContext(fs.readFileSync(path.join(root, "js", "stitch-catalog.js"), "utf8"), {
  window: windowContext
});
vm.runInNewContext(fs.readFileSync(path.join(root, "js", "diagram-engine.js"), "utf8"), {
  window: windowContext
});

const engine = windowContext.CrocheLabDiagram;

test("the synthetic visual example passes structural and count validation", function () {
  const result = engine.validate(engine.createVisualExample("project-1"));

  assert.equal(result.errors.length, 0);
  assert.equal(result.roundCount, 2);
  assert.equal(result.pointCount, 6);
});

test("an empty draft is not renderable", function () {
  const result = engine.validate(engine.createDraft("project-1"));

  assert.ok(result.errors.length > 0);
});

test("a point cannot link to a point outside the previous round", function () {
  const pattern = engine.createVisualExample("project-1");
  pattern.construction.rounds[1].stitches[0].worksInto = ["missing"];

  assert.ok(engine.validate(pattern).errors.length > 0);
});

test("declared output count is checked against fixed-count symbols", function () {
  const pattern = engine.createVisualExample("project-1");
  pattern.construction.rounds[0].stitchCount = 4;

  assert.ok(engine.validate(pattern).errors.length > 0);
});

test("an increase contributes two output stitches", function () {
  const pattern = engine.createVisualExample("project-1");
  pattern.construction.rounds[0].stitches[0].symbolId = "increase";
  pattern.construction.rounds[0].stitchCount = 4;

  assert.equal(engine.validate(pattern).errors.length, 0);
});

test("symbols from the reference chart render and supported stitches can be used in a sketch", function () {
  const symbols = windowContext.CrocheLabSymbols.all();
  const ids = symbols.map(function (symbol) { return symbol.id; });
  const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "pattern.schema.json"), "utf8"));
  const schemaIds = schema.$defs.sketch.properties.selectedStitchIds.items.enum;
  const supportedIds = symbols
    .filter(function (symbol) { return symbol.diagramSupported !== false && symbol.id !== "repeat"; })
    .map(function (symbol) { return symbol.id; });

  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(Array.from(supportedIds).sort(), Array.from(schemaIds).sort());
  symbols.forEach(function (symbol) {
    assert.match(windowContext.CrocheLabSymbols.render(symbol.id), /<svg/);
  });

  const pattern = engine.createSketch({
    projectId: "project-1",
    photos: [],
    shape: "triangle",
    rows: 3,
    selectedStitchIds: ["magic-ring", "front-post-double-crochet", "popcorn"]
  });
  assert.equal(engine.validate(pattern).errors.length, 0);
  assert.equal(windowContext.CrocheLabSymbols.get("work-start").diagramSupported, false);
});

test("the editorial repeat marker is not accepted as a crochet stitch", function () {
  const pattern = engine.createVisualExample("project-1");
  pattern.construction.rounds[0].stitches[0].symbolId = "repeat";

  assert.ok(engine.validate(pattern).errors.length > 0);
});

test("a guided sketch keeps the selected silhouette, stitches, rows, and source photos", function () {
  const pattern = engine.createSketch({
    projectId: "project-1",
    photos: [{ id: "photo-1", label: "Vista general" }, { id: "photo-2", label: "Detalle" }],
    shape: "triangle",
    rows: 4,
    selectedStitchIds: ["chain", "single-crochet", "double-crochet"]
  });
  const result = engine.validate(pattern);

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.roundCount, 4);
  assert.equal(result.pointCount, 24);
  assert.deepEqual(Array.from(pattern.construction.rounds, function (round) { return round.stitches.length; }), [3, 5, 7, 9]);
  assert.ok(pattern.construction.rounds[0].stitches[0].position.y > pattern.construction.rounds[3].stitches[0].position.y);
  assert.deepEqual(Array.from(pattern.construction.rounds[0].stitches, function (stitch) { return stitch.symbolId; }), [
    "single-crochet",
    "chain",
    "double-crochet"
  ]);
  assert.ok(pattern.construction.rounds[0].stitches[1].position.y < pattern.construction.rounds[0].stitches[0].position.y);
  assert.deepEqual(JSON.parse(JSON.stringify(pattern.sketch)), {
    shape: "triangle",
    detailRows: 4,
    selectedStitchIds: ["chain", "single-crochet", "double-crochet"]
  });
  assert.deepEqual(pattern.sourceImages.map(function (photo) { return photo.role; }), ["primary", "detail"]);
});

test("a sketch rejects duplicated or malformed selected stitches", function () {
  const pattern = engine.createSketch({
    projectId: "project-1",
    photos: [],
    shape: "semicircle",
    rows: 3,
    selectedStitchIds: ["chain"]
  });
  pattern.sketch.selectedStitchIds.push("chain");

  assert.ok(engine.validate(pattern).errors.some(function (message) {
    return message.includes("tipos de punto válidos");
  }));
  assert.throws(function () {
    engine.createSketch({
      projectId: "project-1",
      photos: [],
      shape: "rectangle",
      rows: 3,
      selectedStitchIds: ["chain", "chain"]
    });
  }, /tipo de punto disponible/);
});

test("a border sketch creates radiating fan motifs, base chains, and crowning picots", function () {
  const pattern = engine.createSketch({
    projectId: "project-1",
    photos: [{ id: "photo-1", label: "Puntilla de 3 capuchones" }],
    shape: "border",
    rows: 3,
    selectedStitchIds: ["chain", "double-crochet", "single-crochet", "picot"]
  });
  const result = engine.validate(pattern);

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.roundCount, 3);
  assert.equal(pattern.construction.method, "bottom-up");
  assert.equal(pattern.sketch.shape, "border");

  // Round 1 (foundation) should be at the bottom (greater Y than Round 3 crown)
  assert.ok(pattern.construction.rounds[0].stitches[0].position.y > pattern.construction.rounds[2].stitches[0].position.y);

  // Round 2 (fan round) should contain stitches with radiating rotation angles
  const fanStitches = pattern.construction.rounds[1].stitches.filter(function (s) {
    return s.symbolId === "double-crochet" && Number.isFinite(s.rotation);
  });
  assert.ok(fanStitches.length >= 21); // 3 motifs * 7 double-crochets = 21 fan stitches
  const angles = fanStitches.map(function (s) { return s.rotation; });
  assert.ok(angles.includes(-42));
  assert.ok(angles.includes(0));
  assert.ok(angles.includes(42));

  // Round 3 (crowning round) should contain picots at the crests
  const picotStitches = pattern.construction.rounds[2].stitches.filter(function (s) {
    return s.symbolId === "picot";
  });
  assert.equal(picotStitches.length, 3); // 3 crowning picots
});
