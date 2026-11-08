const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const reconstructionPromise = import("../js/reconstruction.mjs");

function catalog() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "stitch-catalog.js"), "utf8"), { window, Number, Object, Error });
  return window.CrocheLabSymbols;
}

function fanDocument() {
  return {
    schemaVersion: "1.0.0", id: "sample", revision: { id: "rev1", parentId: null, change: null },
    conventions: { rowCountStitchTypes: ["sc", "hdc", "dc", "tr", "sc2tog"], rowCountChainRoles: [] },
    initial: {
      direction: "right_to_left", anchors: ["a1", "a2", "a3"].map(id => ({ id, kind: "stitch" })),
      frontier: ["initial/a1", "initial/a2", "initial/a3"],
      activeLoop: { id: "loop", origin: { kind: "attached_to", anchor: "initial/a1" } }
    },
    motifs: [{
      id: "fan", version: 1, parameters: { target: "anchor", postIds: "tokens" },
      operations: [
        { id: "posts", type: "increase", target: { param: "target" }, stitchType: "dc", stitchIds: { param: "postIds" } },
        { id: "arch", type: "chain", chainIds: { tokens: ["c1", "c2"] }, role: "space_boundary" },
        { id: "close", type: "slip", target: { param: "target" }, reuse: "motif_closure" },
        { id: "space", type: "space", chainId: "arch", closureId: "close" }
      ]
    }],
    rows: [{
      id: "row1", direction: "right_to_left",
      operations: [{
        id: "fans", type: "repeat",
        iterations: ["a1", "a2", "a3"].map((id, i) => ({
          id: `i${i + 1}`, bindings: { target: { ref: `initial/${id}` } }, overrides: {}
        })),
        operations: [{ id: "fan", type: "motif", definitionId: "fan", definitionVersion: 1,
          bindings: { target: { param: "target" }, postIds: { tokens: ["p1", "p2", "p3", "p4", "p5"] } } }]
      }],
      nextPass: { export: ["dc.top", "space.anchor"], carry: [], skip: [], order: "reverse" }
    }]
  };
}

async function reviewedFixture() {
  const api = await reconstructionPromise;
  const project = { id: "fixture", photos: Array.from({ length: 5 }, (_, i) => ({ id: `photo${i + 1}` })) };
  let state = api.createReconstruction(project);
  let id = 0;
  const run = await api.analyzePhotos(project.photos, async photo => [{
    photoId: photo.id, kind: "observation", category: "motif",
    statement: `Observación ficticia ${photo.id}`, confidence: "medium", region: null
  }], () => `finding${++id}`);
  state.analysisRuns.push({ id: "run1", results: run.results });
  state.findings = run.findings;
  for (const finding of state.findings) state = api.reviewFinding(state, finding.id, "confirmed", finding.statement, "Revisión humana");
  state.logicalDocument = fanDocument();
  const operation = state.logicalDocument.rows[0].operations[0];
  state.operationEvidence["row1/fans"] = {
    findingIds: ["finding1"], findingSignatures: { finding1: api.findingSignature(state.findings[0]) },
    signature: api.operationSignature(state.logicalDocument, operation)
  };
  state.completionConfirmed = true;
  return { api, state, run };
}

test("analysis covers every photo, identifies partial failures and preserves photo references", async () => {
  const api = await reconstructionPromise;
  const photos = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}` }));
  const seen = [];
  const result = await api.analyzePhotos(photos, async photo => {
    seen.push(photo.id);
    if (photo.id === "p4") throw new Error("imagen inaccesible");
    return [{ photoId: photo.id, kind: "unknown", statement: "sin identificar" }];
  }, (() => { let n = 0; return () => `f${++n}`; })());
  assert.deepEqual(seen, photos.map(photo => photo.id));
  assert.equal(result.complete, false);
  assert.equal(result.results.length, 6);
  assert.match(result.results[4].error, /inaccesible/);
  assert.deepEqual(result.findings.map(item => item.photoId), ["p0", "p1", "p2", "p3", "p5"]);
  const incorrect = await api.analyzePhotos([photos[0]], async () => [{ photoId: "other" }], () => "f");
  assert.equal(incorrect.results[0].status, "failed");
});

test("reviewed evidence, execution, written instructions and SVG share the same trace", async () => {
  const { api, state, run } = await reviewedFixture();
  assert.equal(run.complete, true);
  const out = api.deriveOutputs(state, catalog());
  assert.equal(out.status, "valid", JSON.stringify(out.diagnostics));
  assert.equal(out.trace.rows[0].counts.stitchesByType.dc, 15);
  assert.equal(out.trace.rows[0].counts.chains, 6);
  assert.equal(out.trace.rows[0].counts.spaces, 3);
  for (const event of out.trace.events) {
    assert.ok(out.instructions.includes(event.id));
    assert.ok(out.svg.includes(`data-event-id="${event.id}"`));
  }
  assert.match(out.svg, /data-relation="works_into"/);
  assert.deepEqual(api.deriveOutputs(state, catalog()), out);
  const reviewed = api.reviewFinding(state, "finding1", "confirmed", "Corrección", "comparación", "inference",
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  assert.equal(reviewed.findings[0].corrections.at(-1).before.statement, "Observación ficticia photo1");
  assert.equal(api.deriveOutputs(reviewed, catalog()).status, "incomplete");
  assert.throws(() => api.reviewFinding(state, "finding1", "confirmed", "x", "", "observation",
    { x: 0.9, y: 0, width: 0.2, height: 1 }), /zona/);
});

test("localized fan correction changes both outputs and counts without changing other fan IDs", async () => {
  const { api, state } = await reviewedFixture();
  const before = api.deriveOutputs(state, catalog());
  const snapshot = structuredClone(state);
  const corrected = api.correctLogicalDocument(state, {
    revisionId: "rev2",
    target: { rowId: "row1", repeatId: "fans", iterationId: "i2", motifId: "fan", parameter: "postIds" },
    before: { tokens: ["p1", "p2", "p3", "p4", "p5"] },
    after: { tokens: ["p1", "p2", "p3", "p4"] }, reason: "Recuento corregido"
  });
  assert.deepEqual(state, snapshot);
  const after = api.deriveOutputs(corrected.reconstruction, catalog());
  assert.equal(after.status, "incomplete");
  assert.equal(after.trace.rows[0].counts.stitchesByType.dc, 14);
  const removed = "row1/fans/i2/fan/posts/p5";
  assert.ok(before.instructions.includes(removed) && before.svg.includes(`data-event-id="${removed}"`));
  assert.ok(!after.instructions.includes(removed) && !after.svg.includes(`data-event-id="${removed}"`));
  for (const iteration of ["i1", "i3"]) {
    const ids = trace => trace.events.filter(event => event.id.includes(`/${iteration}/`)).map(event => event.id);
    assert.deepEqual(ids(before.trace), ids(after.trace));
  }
  assert.ok(corrected.result.invalidated.includes(removed));
  assert.equal(corrected.reconstruction.logicalDocument.revision.parentId, "rev1");
});

test("unknown evidence, missing photo coverage and broken references never pass as valid", async () => {
  const { api, state } = await reviewedFixture();
  state.findings[1].kind = "unknown";
  assert.equal(api.deriveOutputs(state, catalog()).status, "incomplete");
  state.findings[1].review = "rejected";
  state.analysisRuns[0].results[4].status = "failed";
  assert.equal(api.deriveOutputs(state, catalog()).status, "incomplete");
  state.photoReviews.photo5 = true;
  assert.equal(api.deriveOutputs(state, catalog()).status, "valid");
  state.logicalDocument.rows[0].operations[0].iterations[0].bindings.target.ref = "initial/missing";
  const invalid = api.deriveOutputs(state, catalog());
  assert.equal(invalid.status, "invalid");
  assert.ok(invalid.trace.diagnostics.some(item => item.code === "UNKNOWN_ANCHOR"));
});

test("a removed output remains a broken downstream reference rather than being redirected", async () => {
  const { api, state } = await reviewedFixture();
  const initial = api.deriveOutputs(state, catalog());
  const missing = "row1/fans/i2/fan/posts/p5/top";
  const dependent = { id: "dependent", type: "sc", target: { ref: missing } };
  state.logicalDocument.rows.push({
    id: "row2", direction: "left_to_right", operations: [{ id: "turn", type: "turn" }, dependent],
    nextPass: { export: ["sc.top"], carry: [], skip: initial.trace.rows[0].outputFrontier.filter(id => id !== missing), order: "reverse" }
  });
  state.operationEvidence["row2/dependent"] = {
    findingIds: ["finding1"], findingSignatures: { finding1: api.findingSignature(state.findings[0]) },
    signature: api.operationSignature(state.logicalDocument, dependent)
  };
  assert.equal(api.deriveOutputs(state, catalog()).status, "valid");
  const corrected = api.correctLogicalDocument(state, {
    revisionId: "rev2",
    target: { rowId: "row1", repeatId: "fans", iterationId: "i2", motifId: "fan", parameter: "postIds" },
    before: { tokens: ["p1", "p2", "p3", "p4", "p5"] },
    after: { tokens: ["p1", "p2", "p3", "p4"] }, reason: "Recuento corregido"
  });
  assert.ok(corrected.result.brokenReferences.includes(missing));
  assert.equal(corrected.reconstruction.logicalDocument.rows[1].operations[1].target.ref, missing);
  const out = api.deriveOutputs(corrected.reconstruction, catalog());
  assert.equal(out.status, "invalid");
  assert.ok(out.trace.diagnostics.some(item => item.code === "UNKNOWN_ANCHOR"));
  assert.equal(out.trace.rows[1].counts, null);
});

test("automatic pipeline analyzes every photo, executes the proposed construction and preserves previous work", async () => {
  const { generateAutomaticReconstruction } = await import("../js/automatic-reconstruction.mjs");
  const api = await reconstructionPromise;
  const project = { id: "fixture", photos: Array.from({ length: 5 }, (_, i) => ({ id: `photo${i + 1}` })) };
  const previous = api.createReconstruction(project);
  previous.notes = "Conservar revisión manual";
  previous.automatic = { createdAt: "anterior" };
  const original = structuredClone(previous);
  let count = 0;
  const result = await generateAutomaticReconstruction(project, previous, {
    analyzePhoto: async item => [{ photoId: item.id, kind: "observation", category: "motif", statement: "Dato ficticio", confidence: "high", region: null }],
    propose: async findings => ({
      document: fanDocument(), claims: [{ path: "row1/fans", findingIds: [findings[0].id], confidence: "high" }],
      assumptions: [], unknowns: [], complete: true
    }),
    makeFindingId: () => `f${++count}`, now: () => "now", catalog: catalog()
  });
  assert.deepEqual(previous, original);
  assert.equal(result.notes, previous.notes);
  assert.equal(result.automaticHistory[0].createdAt, "anterior");
  assert.equal(result.automatic.findings.length, 5);
  assert.equal(result.automatic.photoResults.length, 5);
  assert.equal(result.automatic.outputs.status, "valid");
  assert.equal(result.automatic.outputs.trace.rows[0].counts.stitchesByType.dc, 15);
  assert.equal((result.automatic.outputs.instructions.match(/Teje punto alto/g) || []).length, 15);
  assert.equal((result.automatic.outputs.svg.match(/data-event-id=/g) || []).length, result.automatic.outputs.trace.events.length);
  assert.equal(result.findings.length, 0);
  const fragment = await generateAutomaticReconstruction(project, null, {
    analyzePhoto: async item => [{ photoId: item.id, kind: "observation", category: "motif", statement: "Dato ficticio", confidence: "high", region: null }],
    propose: async findings => ({
      document: fanDocument(), claims: [{ path: "row1/fans", findingIds: [findings[0].id], confidence: "high" }],
      assumptions: [], unknowns: [], complete: false
    }),
    makeFindingId: () => `f${++count}`, now: () => "now", catalog: catalog()
  });
  assert.equal(fragment.automatic.outputs.logicalStatus, "valid");
  assert.equal(fragment.automatic.outputs.status, "incomplete");
  assert.ok(fragment.automatic.outputs.diagnostics.some(item => item.includes("toda la pieza")));
});

test("automatic proposals expose failed photos, unsupported evidence and invalid structures", async () => {
  const { generateAutomaticReconstruction } = await import("../js/automatic-reconstruction.mjs");
  const project = { id: "fixture", photos: [{ id: "p1" }, { id: "p2" }] };
  const options = {
    analyzePhoto: async item => {
      if (item.id === "p2") throw new Error("imagen inaccesible");
      return [{ photoId: item.id, kind: "inference", category: "stitch", statement: "Interpretación ficticia", confidence: "low", region: null }];
    },
    makeFindingId: () => "f1", now: () => "now", catalog: catalog()
  };
  const partial = await generateAutomaticReconstruction(project, null, { ...options, propose: async findings => ({
    document: fanDocument(), claims: [{ path: "row1/fans", findingIds: [findings[0].id], confidence: "low" }],
    assumptions: ["No se distingue el recuento"], unknowns: [], complete: false
  }) });
  assert.equal(partial.automatic.outputs.status, "incomplete");
  assert.equal(partial.automatic.photoResults[1].status, "failed");
  assert.ok(partial.automatic.outputs.diagnostics.some(item => item.includes("interpretación")));
  const invalidClaim = await generateAutomaticReconstruction(project, null, { ...options, propose: async () => ({
    document: fanDocument(), claims: [{ path: "row1/fans", findingIds: ["invented"], confidence: "high" }],
    assumptions: [], unknowns: [], complete: false
  }) });
  assert.equal(invalidClaim.automatic.outputs.trace, null);
  assert.ok(invalidClaim.automatic.outputs.diagnostics.some(item => item.includes("evidencias")));
  let calls = 0;
  const broken = fanDocument();
  broken.rows[0].operations[0].iterations[0].bindings.target.ref = "initial/missing";
  const retried = await generateAutomaticReconstruction(project, null, { ...options, propose: async findings => {
    calls++;
    return { document: broken, claims: [{ path: "row1/fans", findingIds: [findings[0].id], confidence: "low" }], assumptions: [], unknowns: [], complete: false };
  } });
  assert.equal(calls, 2);
  assert.equal(retried.automatic.outputs.status, "invalid");
  assert.ok(retried.automatic.outputs.trace.diagnostics.some(item => item.code === "UNKNOWN_ANCHOR"));
});
