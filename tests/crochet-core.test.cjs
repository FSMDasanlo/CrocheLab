const assert = require("node:assert/strict");
const test = require("node:test");
const Ajv2020 = require("ajv/dist/2020").default;
const coreSchema = require("../schemas/crochet-core.schema.json");
const traceSchema = require("../schemas/crochet-trace.schema.json");
const corePromise = import("../js/crochet-core/index.mjs");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateInput = ajv.compile(coreSchema);
const validateTrace = ajv.compile(traceSchema);

function documentFor(anchorIds, operations, options = {}) {
  return {
    schemaVersion: "1.0.0",
    id: "sample",
    revision: { id: "rev1", parentId: null, change: null },
    conventions: { rowCountStitchTypes: ["sc", "hdc", "dc", "tr", "sc2tog"], rowCountChainRoles: [] },
    initial: {
      direction: "right_to_left",
      anchors: anchorIds.map(id => ({ id, kind: "stitch" })),
      frontier: anchorIds.map(id => `initial/${id}`),
      activeLoop: { id: "loop", origin: { kind: "attached_to", anchor: `initial/${anchorIds[0]}` } }
    },
    motifs: options.motifs || [],
    rows: [{
      id: "row1", direction: "right_to_left", operations,
      nextPass: { export: options.export || ["sc.top"], carry: [], skip: [], order: "reverse" }
    }]
  };
}
function assertSchemas(document, result) {
  assert.equal(validateInput(document), true, JSON.stringify(validateInput.errors));
  assert.equal(validateTrace(result), true, JSON.stringify(validateTrace.errors));
}
function stitch(id, type, target) { return { id, type, target: { ref: target } }; }
function fanDocument() {
  const motif = {
    id: "fan", version: 1, parameters: { target: "anchor", postIds: "tokens" },
    operations: [
      { id: "posts", type: "increase", target: { param: "target" }, stitchType: "dc", stitchIds: { param: "postIds" } },
      { id: "arch", type: "chain", chainIds: { tokens: ["c1", "c2"] }, role: "space_boundary" },
      { id: "close", type: "slip", target: { param: "target" }, reuse: "motif_closure" },
      { id: "space", type: "space", chainId: "arch", closureId: "close" }
    ]
  };
  const repeat = {
    id: "fans", type: "repeat",
    iterations: ["a1", "a2", "a3"].map((id, i) => ({
      id: `i${i + 1}`, bindings: { target: { ref: `initial/${id}` } }, overrides: {}
    })),
    operations: [{
      id: "fan", type: "motif", definitionId: "fan", definitionVersion: 1,
      bindings: { target: { param: "target" }, postIds: { tokens: ["p1", "p2", "p3", "p4", "p5"] } }
    }]
  };
  return documentFor(["a1", "a2", "a3"], [repeat], { motifs: [motif], export: ["dc.top", "space.anchor"] });
}
function code(result, expected) {
  assert.ok(result.diagnostics.some(item => item.code === expected), JSON.stringify(result.diagnostics));
}

test("A: row counts and explicit loop/frontier transfer across two rows", async () => {
  const { execute } = await corePromise;
  const document = documentFor(["a", "b", "c"], ["a", "b", "c"].map((id, i) => stitch(`p${i + 1}`, "sc", `initial/${id}`)));
  document.rows.push({
    id: "row2", direction: "left_to_right",
    operations: [
      { id: "turn", type: "turn" },
      ...[3, 2, 1].map((n, i) => stitch(`p${i + 1}`, "sc", `row1/p${n}/top`))
    ],
    nextPass: { export: ["sc.top"], carry: [], skip: [], order: "reverse" }
  });
  const result = execute(document);
  assertSchemas(document, result);
  assert.equal(result.status, "valid", JSON.stringify(result.diagnostics));
  const first = result.rows[0];
  assert.equal(first.counts.availableInputs, 3);
  assert.equal(first.counts.consumedInputs, 3);
  assert.equal(first.counts.reuses, 0);
  assert.equal(first.counts.stitchesByType.sc, 3);
  assert.equal(first.counts.exported.stitch, 3);
  assert.deepEqual(first.outputFrontier, ["row1/p3/top", "row1/p2/top", "row1/p1/top"]);
  assert.deepEqual(result.rows[1].inputFrontier, first.outputFrontier);
  assert.equal(first.loopAfter, "row1/p3/loop");
  assert.equal(result.rows[1].loopBefore, first.loopAfter);
  assert.equal(result.events[3].type, "turn");
  assert.equal(result.events[3].directionBefore, "right_to_left");
  assert.equal(result.events[3].directionAfter, "left_to_right");
  assert.equal(result.rows[1].directionAfter, "left_to_right");
  assert.equal(result.events[3].loopAfter, first.loopAfter);
  assert.equal(result.events[4].loopBefore, first.loopAfter);
  assert.equal(result.events[0].loopBefore, "initial/loop");
  assert.deepEqual(result.initialState.activeLoop, { id: "initial/loop", origin: { kind: "attached_to", anchor: "initial/a" } });
  assert.deepEqual(result, execute(document));
});

test("B: increase expands into two complete stitches and one authorized reuse", async () => {
  const { execute, expand } = await corePromise;
  const document = documentFor(["a"], [{ id: "inc", type: "increase", target: { ref: "initial/a" }, stitchType: "sc", stitchIds: { tokens: ["p1", "p2"] } }]);
  const result = execute(document);
  assertSchemas(document, result);
  assert.equal(result.status, "valid", JSON.stringify(result.diagnostics));
  assert.deepEqual(expand(document).rows[0].items.map(item => item.id), ["row1/inc/p1", "row1/inc/p2"]);
  assert.deepEqual(result.events.map(event => event.inputs[0].usage), ["first", "reuse"]);
  assert.deepEqual(result.events.map(event => event.inputs[0].reuseReason), [null, "increase"]);
  assert.equal(result.events[1].loopBefore, result.events[0].loopAfter);
  assert.deepEqual(result.rows[0].outputFrontier, ["row1/inc/p2/top", "row1/inc/p1/top"]);
  const counts = result.rows[0].counts;
  assert.equal(counts.consumedInputs, 1);
  assert.equal(counts.reuses, 1);
  assert.equal(counts.stitchesByType.sc, 2);
  assert.equal(counts.exported.stitch, 2);
});

test("C: a two-input single-crochet decrease produces one linked stitch", async () => {
  const { execute } = await corePromise;
  const document = documentFor(["a", "b"], [{ id: "dec", type: "decrease", technique: "sc2tog", targets: [{ ref: "initial/a" }, { ref: "initial/b" }] }], { export: ["sc2tog.top"] });
  const result = execute(document);
  assertSchemas(document, result);
  assert.equal(result.status, "valid", JSON.stringify(result.diagnostics));
  const counts = result.rows[0].counts;
  assert.equal(counts.consumedInputs, 2);
  assert.equal(counts.reuses, 0);
  assert.equal(counts.stitchesByType.sc2tog, 1);
  assert.equal(counts.totalStitches, 1);
  assert.equal(counts.exported.stitch, 1);
  assert.deepEqual(result.events[0].connections.filter(link => link.type === "works_into").map(link => link.to), ["initial/a", "initial/b"]);
});

test("D: three fictional fans expand with unique IDs, continuous loops, connections and counts", async () => {
  const { execute } = await corePromise;
  const document = fanDocument();
  const result = execute(document);
  assertSchemas(document, result);
  assert.equal(result.status, "valid", JSON.stringify(result.diagnostics));
  assert.equal(result.events.length, 27);
  const ids = result.events.flatMap(event => event.produced.map(value => value.id));
  assert.equal(new Set(ids).size, ids.length);
  for (let i = 1; i < result.events.length; i++) assert.equal(result.events[i].loopBefore, result.events[i - 1].loopAfter);
  for (let i = 1; i <= 3; i++) {
    const root = `row1/fans/i${i}/fan`;
    const events = result.events.filter(event => event.id.startsWith(`${root}/`));
    assert.deepEqual(events.map(event => event.id), [
      ...[1, 2, 3, 4, 5].map(n => `${root}/posts/p${n}`),
      `${root}/arch/c1`, `${root}/arch/c2`, `${root}/close`, `${root}/space`
    ]);
    assert.deepEqual(events.slice(0, 5).map(event => event.inputs[0].usage), ["first", "reuse", "reuse", "reuse", "reuse"]);
    assert.equal(events[7].inputs[0].usage, "reuse");
    assert.equal(events[7].inputs[0].reuseReason, "motif_closure");
    assert.equal(events[5].connections.find(link => link.type === "starts_at").to, `${root}/posts/p5/top`);
    assert.equal(events[6].connections.find(link => link.type === "follows").to, `${root}/arch/c1/chain`);
    assert.equal(events[7].connections.find(link => link.type === "works_into").to, `initial/a${i}`);
    const links = events[8].connections;
    assert.deepEqual(links.filter(link => link.type === "bounded_by").map(link => link.to), [`${root}/arch/c1/chain`, `${root}/arch/c2/chain`]);
    assert.ok(links.some(link => link.type === "closed_at" && link.to === `${root}/close/point`));
    assert.ok(links.some(link => link.type === "anchor_of" && link.from === `${root}/space/anchor` && link.to === `${root}/space/space`));
    for (let n = 1; n <= 5; n++) assert.ok(result.rows[0].outputFrontier.includes(`${root}/posts/p${n}/top`));
    assert.ok(result.rows[0].outputFrontier.includes(`${root}/space/anchor`));
  }
  const counts = result.rows[0].counts;
  assert.deepEqual(
    [counts.availableInputs, counts.consumedInputs, counts.reuses, counts.stitchesByType.dc, counts.stitchesByType.slip, counts.totalStitches, counts.rowCount, counts.chains, counts.spaces, counts.exported.stitch, counts.exported.space],
    [3, 3, 15, 15, 3, 18, 15, 6, 3, 15, 3]
  );
  assert.deepEqual(result, execute(document));
  document.conventions.rowCountStitchTypes.push("slip");
  document.conventions.rowCountChainRoles.push("space_boundary");
  assert.equal(execute(document).rows[0].counts.rowCount, 24);
});

test("E: correction keeps revisions and identities, recalculates dependencies and reports broken references", async () => {
  const { execute, applyCorrection } = await corePromise;
  const document = fanDocument();
  const first = execute(document);
  const missing = "row1/fans/i2/fan/posts/p5/top";
  document.rows.push({
    id: "row2", direction: "left_to_right",
    operations: [{ id: "turn", type: "turn" }, stitch("dependent", "sc", missing)],
    nextPass: { export: ["sc.top"], carry: [], skip: first.rows[0].outputFrontier.filter(id => id !== missing), order: "reverse" }
  });
  assert.equal(execute(document).status, "valid");
  const before = structuredClone(document);
  const change = {
    revisionId: "rev2",
    target: { rowId: "row1", repeatId: "fans", iterationId: "i2", motifId: "fan", parameter: "postIds" },
    before: { tokens: ["p1", "p2", "p3", "p4", "p5"] },
    after: { tokens: ["p1", "p2", "p3", "p4"] },
    reason: "Corrección humana"
  };
  const corrected = applyCorrection(document, change);
  assert.equal(corrected.applied, true);
  assert.equal(corrected.status, "invalid");
  assert.deepEqual(document, before);
  assert.equal(corrected.document.revision.parentId, "rev1");
  assert.deepEqual(corrected.document.revision.change.before, change.before);
  assert.deepEqual(corrected.document.revision.change.after, change.after);
  assert.ok(corrected.brokenReferences.includes(missing));
  assert.ok(corrected.invalidated.includes("row1/fans/i2/fan/posts/p5"));
  assert.ok(corrected.invalidated.includes("row1/fans/i3/fan/posts/p1"));
  const result = execute(corrected.document);
  assertSchemas(corrected.document, result);
  const counts = result.rows[0].counts;
  assert.deepEqual([counts.consumedInputs, counts.reuses, counts.stitchesByType.dc, counts.stitchesByType.slip, counts.chains, counts.spaces, counts.exported.stitch, counts.exported.space], [3, 14, 14, 3, 6, 3, 14, 3]);
  assert.ok(result.events.some(event => event.id === "row1/fans/i2/fan/posts/p4"));
  assert.ok(!result.events.some(event => event.id === "row1/fans/i2/fan/posts/p5"));
  for (const i of [1, 3]) for (let n = 1; n <= 5; n++) assert.ok(result.events.some(event => event.id === `row1/fans/i${i}/fan/posts/p${n}`));
  assert.equal(result.rows[1].counts, null);
  code(result, "UNKNOWN_ANCHOR");
  const conflict = applyCorrection(corrected.document, { ...change, revisionId: "rev3" });
  assert.equal(conflict.applied, false);
  code(conflict, "CORRECTION_CONFLICT");
  const namedConstructor = fanDocument();
  namedConstructor.rows[0].operations[0].operations[0].id = "constructor";
  const ownConstructor = Object.hasOwn(Object, "postIds");
  const namedChange = { ...change, target: { ...change.target, motifId: "constructor" } };
  const safeCorrection = applyCorrection(namedConstructor, namedChange);
  assert.equal(safeCorrection.applied, true);
  assert.equal(Object.hasOwn(Object, "postIds"), ownConstructor);
  assert.ok(Object.hasOwn(safeCorrection.document.rows[0].operations[0].iterations[1].overrides, "constructor"));
  const directDocument = documentFor(["a"], [stitch("s1", "sc", "initial/a")], { export: ["sc.top", "dc.top"] });
  const direct = applyCorrection(directDocument, {
    revisionId: "rev2", target: { rowId: "row1", operationId: "s1", parameter: "type" },
    before: "sc", after: "dc", reason: "Corrección del punto"
  });
  assert.equal(direct.applied, true);
  assert.equal(direct.status, "valid");
  assert.equal(directDocument.rows[0].operations[0].type, "sc");
  assert.equal(execute(direct.document).rows[0].counts.stitchesByType.dc, 1);
  assertSchemas(direct.document, execute(direct.document));
});

test("F: explicit incomplete and invalid states reject malformed and impossible constructions", async () => {
  const { execute, validateDocument } = await corePromise;
  const good = documentFor(["a", "b"], [stitch("a", "sc", "initial/a"), stitch("b", "sc", "initial/b")]);
  const cases = [
    { mutate: d => { d.rows[0].operations[0].target.ref = "initial/missing"; }, status: "invalid", error: "UNKNOWN_ANCHOR" },
    { mutate: d => { d.rows[0].operations[1].id = "a"; }, status: "invalid", error: "DUPLICATE_ID" },
    { mutate: d => { d.rows[0].operations[1].target.ref = "initial/a"; }, status: "invalid", error: "ANCHOR_REUSED" },
    { mutate: d => { d.rows[0].operations[0].type = "unsupported"; }, status: "invalid", error: "STRUCTURE" },
    { mutate: d => { d.initial.activeLoop = null; }, status: "incomplete", error: "MISSING_LOOP" },
    { mutate: d => { d.initial.activeLoop.origin.anchor = "initial/missing"; }, status: "invalid", error: "UNKNOWN_LOOP_ORIGIN" },
    { mutate: d => { d.initial.activeLoop.id = "a"; }, status: "invalid", error: "DUPLICATE_ID" },
    { mutate: d => { d.rows[0].id = "initial"; }, status: "invalid", error: "RESERVED_ID" },
    { mutate: d => { d.rows[0].operations.reverse(); }, status: "invalid", error: "INVALID_ORDER" },
    { mutate: d => { d.rows[0].operations = [{ id: "dec", type: "decrease", technique: "sc2tog", targets: [{ ref: "initial/a" }, { ref: "initial/a" }] }]; }, status: "invalid", error: "DECREASE_INPUTS" },
    { mutate: d => { d.rows[0].operations[0] = { id: "sp", type: "space", chainId: "missing", closureId: "missing" }; }, status: "invalid", error: "INVALID_SPACE" },
    { mutate: d => { d.rows[0].operations[0].target = { unknown: "Falta el anclaje" }; }, status: "incomplete", error: "UNKNOWN_VALUE" },
    { mutate: d => { d.rows[0].operations[0].type = "hdc"; d.rows[0].operations[1].type = "tr"; d.rows[0].nextPass.export = ["hdc.top", "tr.top"]; }, status: "valid" }
  ];
  for (const entry of cases) {
    const document = structuredClone(good);
    entry.mutate(document);
    const result = execute(document);
    assert.equal(result.status, entry.status, JSON.stringify(result.diagnostics));
    if (entry.error) code(result, entry.error);
    assert.equal(validateTrace(result), true, JSON.stringify(validateTrace.errors));
    assert.equal(validateDocument(document).status, result.status);
  }
  const fan = fanDocument();
  delete fan.rows[0].operations[0].operations[0].bindings.postIds;
  const incomplete = execute(fan);
  assert.equal(incomplete.status, "incomplete");
  code(incomplete, "MISSING_PARAMETER");
  assert.equal(incomplete.rows[0].counts, null);
  const unturned = structuredClone(good);
  unturned.rows.push({ ...structuredClone(unturned.rows[0]), id: "row2" });
  code(execute(unturned), "MISSING_TURN");
});
