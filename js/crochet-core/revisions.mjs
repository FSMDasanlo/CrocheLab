import { diagnostic, inspectDocument, statusOf } from "./model.mjs";
import { execute } from "./execute.mjs";
import { expand } from "./expand.mjs";

function equal(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

export function applyCorrection(document, correction) {
  const existingErrors = inspectDocument(document);
  function reject(code, message) {
    const diagnostics = [...existingErrors, diagnostic("invalid", code, message)];
    return { applied: false, status: statusOf(diagnostics), diagnostics, document: null, invalidated: [], brokenReferences: [] };
  }
  if (existingErrors.length) return reject("INVALID_DOCUMENT", "No se puede corregir un documento estructuralmente inválido.");
  if (!correction || typeof correction !== "object" || Array.isArray(correction) ||
      typeof correction.revisionId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(correction.revisionId) ||
      correction.revisionId === document.revision.id || correction.revisionId === document.revision.parentId ||
      typeof correction.reason !== "string" || !correction.reason.length ||
      !correction.target || typeof correction.target !== "object" || !Object.hasOwn(correction, "before") || !Object.hasOwn(correction, "after")) {
    return reject("INVALID_CORRECTION", "La corrección necesita destino, valores, motivo e identificador nuevo.");
  }
  const target = correction.target;
  const direct = Object.hasOwn(target, "operationId");
  const keys = direct ? ["rowId", "operationId", "parameter"] : ["rowId", "repeatId", "iterationId", "motifId", "parameter"];
  if (Object.keys(target).length !== keys.length || keys.some(key => typeof target[key] !== "string")) {
    return reject("INVALID_CORRECTION", "El destino de la corrección no es válido.");
  }
  const row = document.rows.find(item => item.id === target.rowId);
  const operation = direct && row && row.operations.find(item => item.id === target.operationId);
  const repeat = !direct && row && row.operations.find(item => item.id === target.repeatId && item.type === "repeat");
  const iteration = repeat && repeat.iterations.find(item => item.id === target.iterationId);
  const motif = repeat && repeat.operations.find(item => item.id === target.motifId && item.type === "motif");
  const definition = motif && document.motifs.find(item => item.id === motif.definitionId && item.version === motif.definitionVersion);
  let before;
  if (direct) {
    const editable = ["target", "targets", "type", "stitchType", "stitchIds", "chainIds", "role", "reuse", "chainId", "closureId", "technique", "reason"];
    if (!operation || ["repeat", "motif"].includes(operation.type) || !editable.includes(target.parameter) ||
        !Object.hasOwn(operation, target.parameter) ||
        (target.parameter === "type" && (!["sc", "hdc", "dc", "tr"].includes(operation.type) || !["sc", "hdc", "dc", "tr"].includes(correction.after)))) {
      return reject("UNKNOWN_CORRECTION_TARGET", "No se ha encontrado un parámetro editable de la operación.");
    }
    before = operation[target.parameter];
  } else {
    if (!iteration || !motif || !definition || !Object.hasOwn(definition.parameters, target.parameter)) {
      return reject("UNKNOWN_CORRECTION_TARGET", "No se ha encontrado el parámetro de la instancia indicada.");
    }
    const override = Object.hasOwn(iteration.overrides, target.motifId) ? iteration.overrides[target.motifId] : {};
    before = Object.hasOwn(override, target.parameter) ? override[target.parameter] : motif.bindings[target.parameter];
    if (before && Object.hasOwn(before, "param")) before = Object.hasOwn(iteration.bindings, before.param) ? iteration.bindings[before.param] : null;
    if (before && Object.hasOwn(before, "local")) before = { ref: `${row.id}/${repeat.id}/${iteration.id}/${before.local}` };
  }
  if (before === undefined || before === null || !equal(before, correction.before)) {
    return reject("CORRECTION_CONFLICT", "El valor anterior no coincide; no se ha aplicado la corrección.");
  }
  const next = structuredClone(document);
  const nextRow = next.rows.find(item => item.id === target.rowId);
  if (direct) {
    nextRow.operations.find(item => item.id === target.operationId)[target.parameter] = structuredClone(correction.after);
  } else {
    const nextIteration = nextRow.operations.find(item => item.id === target.repeatId).iterations.find(item => item.id === target.iterationId);
    if (!Object.hasOwn(nextIteration.overrides, target.motifId)) nextIteration.overrides[target.motifId] = {};
    nextIteration.overrides[target.motifId][target.parameter] = structuredClone(correction.after);
  }
  next.revision = {
    id: correction.revisionId,
    parentId: document.revision.id,
    change: { origin: "human", target: structuredClone(target), before: structuredClone(correction.before), after: structuredClone(correction.after), reason: correction.reason }
  };
  const errors = inspectDocument(next);
  if (errors.length) return { applied: false, status: statusOf(errors), diagnostics: errors, document: null, invalidated: [], brokenReferences: [] };
  const previous = execute(document);
  const current = execute(next);
  const currentEvents = new Map(current.events.map(event => [event.id, event]));
  const invalidated = new Set();
  for (const event of previous.events) {
    const replacement = currentEvents.get(event.id);
    if (!replacement || !equal(event, replacement) || event.dependsOn.some(id => invalidated.has(id))) invalidated.add(event.id);
  }
  const expanded = expand(next);
  const declared = new Set(next.initial.anchors.map(anchor => `initial/${anchor.id}`));
  for (const row of expanded.rows) for (const event of row.items) {
    if (["sc", "hdc", "dc", "tr", "sc2tog", "slip"].includes(event.type)) declared.add(`${event.id}/top`);
    if (event.type === "chain" || event.type === "space") declared.add(`${event.id}/anchor`);
  }
  const broken = current.diagnostics.filter(item => item.code === "UNKNOWN_ANCHOR" || item.code === "ANCHOR_NOT_AVAILABLE")
    .map(item => item.reference).filter(Boolean);
  for (const row of expanded.rows) for (const event of row.items) {
    const targets = event.targets || (event.target ? [event.target] : []);
    for (const targetId of targets) if (!declared.has(targetId)) broken.push(targetId);
  }
  for (const row of next.rows) {
    for (const targetId of [...row.nextPass.carry, ...row.nextPass.skip]) {
      if (!declared.has(targetId)) broken.push(targetId);
    }
  }
  const brokenReferences = [...new Set(broken)];
  return {
    applied: true,
    status: current.status,
    diagnostics: current.diagnostics,
    document: next,
    invalidated: [...invalidated],
    brokenReferences
  };
}
