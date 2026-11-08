const assert = require("node:assert/strict");
const test = require("node:test");
const Ajv2020 = require("ajv/dist/2020").default;
const coreSchema = require("../schemas/crochet-core.schema.json");
const traceSchema = require("../schemas/crochet-trace.schema.json");

const ajv = new Ajv2020({ allErrors: true, strict: true });

test("the input and trace schemas compile with standard JSON Schema validation", () => {
  assert.ok(ajv.compile(coreSchema));
  assert.ok(ajv.compile(traceSchema));
});

test("input schema requires an independent initial loop and rejects malformed operations", async () => {
  const validate = ajv.compile(coreSchema);
  const { inspectDocument } = await import("../js/crochet-core/model.mjs");
  const document = {
    schemaVersion: "1.0.0",
    id: "sample",
    revision: { id: "rev1", parentId: null, change: null },
    conventions: { rowCountStitchTypes: ["sc"], rowCountChainRoles: [] },
    initial: {
      direction: "right_to_left",
      anchors: [{ id: "a", kind: "stitch" }],
      frontier: ["initial/a"],
      activeLoop: { id: "loop", origin: { kind: "attached_to", anchor: "initial/a" } }
    },
    motifs: [],
    rows: [{
      id: "row1", direction: "right_to_left",
      operations: [{ id: "s1", type: "sc", target: { ref: "initial/a" } }],
      nextPass: { export: ["sc.top"], carry: [], skip: [], order: "reverse" }
    }]
  };
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  const missingLoopId = structuredClone(document);
  delete missingLoopId.initial.activeLoop.id;
  assert.equal(validate(missingLoopId), false);
  const malformed = structuredClone(document);
  malformed.rows[0].operations[0].target = "initial/a";
  assert.equal(validate(malformed), false);
  const extra = structuredClone(document);
  extra.rows[0].operations[0].invented = true;
  assert.equal(validate(extra), false);
  for (const sample of [document, missingLoopId, malformed, extra]) {
    assert.equal(inspectDocument(sample).length === 0, validate(sample), JSON.stringify(validate.errors));
  }
});
