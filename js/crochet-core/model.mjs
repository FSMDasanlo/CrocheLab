export const ENGINE_VERSION = "1.0.0";
export const STITCH_TYPES = ["sc", "hdc", "dc", "tr", "sc2tog", "slip"];
export const CHAIN_ROLES = ["foundation", "turning", "space_boundary", "decorative"];
export const EXPORT_TYPES = [...STITCH_TYPES.map(type => `${type}.top`), "chain.anchor", "space.anchor"];
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const REF = /^[A-Za-z][A-Za-z0-9_-]*(\/[A-Za-z][A-Za-z0-9_-]*)+$/;

export function diagnostic(status, code, message, rowId = null, operationId = null, reference = null) {
  return { status, code, rowId, operationId, reference, message };
}

export function statusOf(diagnostics) {
  return diagnostics.some(item => item.status === "invalid") ? "invalid"
    : diagnostics.some(item => item.status === "incomplete") ? "incomplete" : "valid";
}

// This validates the domain contract, not arbitrary JSON Schema documents.
export function inspectDocument(document) {
  const errors = [];
  function bad(path, message) { errors.push(diagnostic("invalid", "STRUCTURE", `${path}: ${message}`)); }
  function object(value, path, required, optional = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { bad(path, "se esperaba un objeto"); return false; }
    for (const key of required) if (!Object.hasOwn(value, key)) bad(path, `falta ${key}`);
    for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) bad(path, `campo desconocido ${key}`);
    return true;
  }
  function id(value, path) { if (typeof value !== "string" || !ID.test(value)) bad(path, "identificador inválido"); }
  function ref(value, path) { if (typeof value !== "string" || value.length > 1024 || !REF.test(value)) bad(path, "referencia inválida"); }
  function text(value, path) { if (typeof value !== "string" || value.length === 0) bad(path, "se esperaba texto no vacío"); }
  function choice(value, options, path) { if (!options.includes(value)) bad(path, "valor no admitido"); }
  function list(value, path, item, max = 1000, min = 0, unique = false) {
    if (!Array.isArray(value)) { bad(path, "se esperaba una lista"); return; }
    if (value.length < min || value.length > max) bad(path, "tamaño no admitido");
    if (unique && new Set(value).size !== value.length) bad(path, "valores duplicados");
    value.forEach((v, i) => item(v, `${path}[${i}]`));
  }
  function expr(value, path, kind) {
    if (!object(value, path, [], ["ref", "local", "param", "unknown", "tokens"])) return;
    const keys = Object.keys(value);
    if (keys.length !== 1) { bad(path, "se requiere exactamente una variante"); return; }
    const key = keys[0];
    if ((key === "ref" || key === "local") && kind !== "tokens") ref(value[key], `${path}.${key}`);
    else if (key === "param") id(value[key], `${path}.param`);
    else if (key === "unknown") text(value[key], `${path}.unknown`);
    else if (key === "tokens" && kind !== "anchor") list(value.tokens, `${path}.tokens`, id, 1000, 1, true);
    else bad(path, "variante incompatible");
  }
  function bindings(value, path) {
    if (!object(value, path, [], Object.keys(value && typeof value === "object" && !Array.isArray(value) ? value : {}))) return;
    for (const [key, val] of Object.entries(value)) { id(key, path); expr(val, `${path}.${key}`, "value"); }
  }
  function operations(value, path, scope, min = 0) {
    list(value, path, (op, at) => operation(op, at, scope), 1000, min);
  }
  function operation(op, path, scope) {
    if (!op || typeof op !== "object" || Array.isArray(op)) { bad(path, "operación inválida"); return; }
    const fields = {
      sc: ["id", "type", "target"], hdc: ["id", "type", "target"], dc: ["id", "type", "target"], tr: ["id", "type", "target"],
      slip: ["id", "type", "target", "reuse"], chain: ["id", "type", "chainIds", "role"],
      increase: ["id", "type", "target", "stitchType", "stitchIds"], decrease: ["id", "type", "targets", "technique"],
      space: ["id", "type", "chainId", "closureId"], turn: ["id", "type"], unknown: ["id", "type", "reason"],
      motif: ["id", "type", "definitionId", "definitionVersion", "bindings"],
      repeat: ["id", "type", "iterations", "operations"]
    };
    if (!Object.hasOwn(fields, op.type) || (scope === "motif" && ["motif", "repeat"].includes(op.type)) || (scope === "repeat" && op.type === "repeat")) {
      bad(path, "tipo de operación no admitido"); return;
    }
    object(op, path, fields[op.type]);
    id(op.id, `${path}.id`);
    if (["sc", "hdc", "dc", "tr", "slip", "increase"].includes(op.type)) expr(op.target, `${path}.target`, "anchor");
    if (op.type === "slip") choice(op.reuse, ["none", "motif_closure"], `${path}.reuse`);
    if (op.type === "chain") { expr(op.chainIds, `${path}.chainIds`, "tokens"); choice(op.role, CHAIN_ROLES, `${path}.role`); }
    if (op.type === "increase") { expr(op.stitchIds, `${path}.stitchIds`, "tokens"); choice(op.stitchType, STITCH_TYPES.slice(0, 4), `${path}.stitchType`); }
    if (op.type === "decrease") {
      list(op.targets, `${path}.targets`, (v, p) => expr(v, p, "anchor"), 2, 2);
      choice(op.technique, ["sc2tog"], `${path}.technique`);
    }
    if (op.type === "space") { id(op.chainId, `${path}.chainId`); id(op.closureId, `${path}.closureId`); }
    if (op.type === "unknown") text(op.reason, `${path}.reason`);
    if (op.type === "motif") {
      id(op.definitionId, `${path}.definitionId`);
      if (!Number.isInteger(op.definitionVersion) || op.definitionVersion < 1) bad(path, "versión de motivo inválida");
      bindings(op.bindings, `${path}.bindings`);
    }
    if (op.type === "repeat") {
      list(op.iterations, `${path}.iterations`, (it, p) => {
        if (!object(it, p, ["id", "bindings", "overrides"])) return;
        id(it.id, `${p}.id`); bindings(it.bindings, `${p}.bindings`);
        if (object(it.overrides, `${p}.overrides`, [], Object.keys(it.overrides && typeof it.overrides === "object" && !Array.isArray(it.overrides) ? it.overrides : {}))) {
          for (const [key, val] of Object.entries(it.overrides)) { id(key, p); bindings(val, `${p}.overrides.${key}`); }
        }
      }, 1000, 1);
      operations(op.operations, `${path}.operations`, "repeat", 1);
    }
  }
  if (!object(document, "document", ["schemaVersion", "id", "revision", "conventions", "initial", "motifs", "rows"])) return errors;
  if (document.schemaVersion !== "1.0.0") {
    if (typeof document.schemaVersion === "string" && document.schemaVersion.length > 0) errors.push(diagnostic("incomplete", "UNSUPPORTED_VERSION", "Versión del contrato no admitida."));
    else bad("schemaVersion", "versión inválida");
  }
  id(document.id, "id");
  if (object(document.revision, "revision", ["id", "parentId", "change"])) {
    id(document.revision.id, "revision.id");
    if (document.revision.parentId !== null) id(document.revision.parentId, "revision.parentId");
    const change = document.revision.change;
    if (change !== null && object(change, "revision.change", ["origin", "target", "before", "after", "reason"])) {
      choice(change.origin, ["human"], "revision.change.origin");
      const targetFields = change.target && Object.hasOwn(change.target, "operationId")
        ? ["rowId", "operationId", "parameter"] : ["rowId", "repeatId", "iterationId", "motifId", "parameter"];
      if (object(change.target, "revision.change.target", targetFields)) {
        for (const [key, val] of Object.entries(change.target)) id(val, `revision.change.target.${key}`);
      }
      for (const key of ["before", "after"]) {
        const value = change[key];
        if (typeof value === "string") text(value, `revision.change.${key}`);
        else if (Array.isArray(value)) list(value, `revision.change.${key}`, (v, p) => expr(v, p, "anchor"), 2, 2);
        else expr(value, `revision.change.${key}`, "value");
      }
      text(change.reason, "revision.change.reason");
    }
  }
  if (object(document.conventions, "conventions", ["rowCountStitchTypes", "rowCountChainRoles"])) {
    list(document.conventions.rowCountStitchTypes, "conventions.rowCountStitchTypes", (v, p) => choice(v, STITCH_TYPES, p), Infinity, 0, true);
    list(document.conventions.rowCountChainRoles, "conventions.rowCountChainRoles", (v, p) => choice(v, CHAIN_ROLES, p), Infinity, 0, true);
  }
  if (object(document.initial, "initial", ["direction", "anchors", "frontier", "activeLoop"])) {
    choice(document.initial.direction, ["left_to_right", "right_to_left", null], "initial.direction");
    list(document.initial.anchors, "initial.anchors", (a, p) => {
      if (object(a, p, ["id", "kind"])) { id(a.id, `${p}.id`); choice(a.kind, ["stitch", "chain", "space", "edge"], `${p}.kind`); }
    });
    list(document.initial.frontier, "initial.frontier", ref, 10000, 0, true);
    const loop = document.initial.activeLoop;
    if (loop !== null && object(loop, "initial.activeLoop", ["id", "origin"])) {
      id(loop.id, "initial.activeLoop.id");
      if (object(loop.origin, "initial.activeLoop.origin", ["kind", "anchor"])) {
        choice(loop.origin.kind, ["attached_to"], "initial.activeLoop.origin.kind");
        ref(loop.origin.anchor, "initial.activeLoop.origin.anchor");
      }
    }
  }
  list(document.motifs, "motifs", (motif, p) => {
    if (!object(motif, p, ["id", "version", "parameters", "operations"])) return;
    id(motif.id, `${p}.id`);
    if (!Number.isInteger(motif.version) || motif.version < 1) bad(p, "versión inválida");
    if (object(motif.parameters, `${p}.parameters`, [], Object.keys(motif.parameters && typeof motif.parameters === "object" && !Array.isArray(motif.parameters) ? motif.parameters : {}))) {
      for (const [key, val] of Object.entries(motif.parameters)) { id(key, p); choice(val, ["anchor", "tokens"], `${p}.parameters.${key}`); }
    }
    operations(motif.operations, `${p}.operations`, "motif", 1);
  }, 100);
  list(document.rows, "rows", (row, p) => {
    if (!object(row, p, ["id", "direction", "operations", "nextPass"])) return;
    id(row.id, `${p}.id`); choice(row.direction, ["left_to_right", "right_to_left", null], `${p}.direction`);
    operations(row.operations, `${p}.operations`, "row");
    if (object(row.nextPass, `${p}.nextPass`, ["export", "carry", "skip", "order"])) {
      list(row.nextPass.export, `${p}.nextPass.export`, (v, at) => choice(v, EXPORT_TYPES, at), Infinity, 0, true);
      list(row.nextPass.carry, `${p}.nextPass.carry`, ref, 10000, 0, true);
      list(row.nextPass.skip, `${p}.nextPass.skip`, ref, 10000, 0, true);
      choice(row.nextPass.order, ["same", "reverse"], `${p}.nextPass.order`);
    }
  });
  return errors;
}
