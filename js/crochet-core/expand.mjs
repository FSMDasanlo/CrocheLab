import { diagnostic, inspectDocument, statusOf } from "./model.mjs";

const MAX_EVENTS = 10000;

export function expand(document) {
  const diagnostics = inspectDocument(document);
  if (diagnostics.length) return { status: statusOf(diagnostics), diagnostics, rows: [] };
  const rows = [];
  const definitions = new Map();
  const rowIds = new Set();
  let eventCount = 0;
  for (const definition of document.motifs) {
    const key = `${definition.id}@${definition.version}`;
    if (definitions.has(key)) diagnostics.push(diagnostic("invalid", "DUPLICATE_MOTIF", "Definición de motivo duplicada.", null, null, key));
    else definitions.set(key, definition);
  }
  function issue(items, status, code, message, rowId, operationId, reference = null) {
    if (eventCount >= MAX_EVENTS) {
      if (eventCount === MAX_EVENTS) {
        const limit = diagnostic("invalid", "EXPANSION_LIMIT", "La expansión supera 10000 operaciones o incidencias.", rowId, operationId);
        diagnostics.push(limit);
        items.push({ type: "issue", diagnostic: limit });
      }
      eventCount = MAX_EVENTS + 1;
      return;
    }
    eventCount++;
    const problem = diagnostic(status, code, message, rowId, operationId, reference);
    diagnostics.push(problem);
    items.push({ type: "issue", diagnostic: problem });
  }
  function unique(items, values, rowId, operationId, label) {
    const seen = new Set();
    for (const value of values) {
      if (seen.has(value.id)) {
        issue(items, "invalid", "DUPLICATE_ID", `Identificador duplicado en ${label}.`, rowId, operationId, value.id);
        return false;
      }
      seen.add(value.id);
    }
    return true;
  }
  function resolve(expr, kind, environment, prefix, items, rowId, opId) {
    if (Object.hasOwn(expr, "unknown")) {
      issue(items, "incomplete", "UNKNOWN_VALUE", expr.unknown, rowId, opId);
      return null;
    }
    if (Object.hasOwn(expr, "param")) {
      const value = Object.hasOwn(environment, expr.param) ? environment[expr.param] : null;
      if (!value) {
        issue(items, "incomplete", "MISSING_PARAMETER", "Falta un parámetro del motivo o repetición.", rowId, opId, expr.param);
        return null;
      }
      if (kind === "anchor" && typeof value.ref === "string") return value.ref;
      if (kind === "tokens" && Array.isArray(value.tokens)) return value.tokens;
      issue(items, "invalid", "PARAMETER_TYPE", "El parámetro tiene un tipo incompatible.", rowId, opId, expr.param);
      return null;
    }
    if (kind === "anchor" && Object.hasOwn(expr, "ref")) return expr.ref;
    if (kind === "anchor" && Object.hasOwn(expr, "local")) return `${prefix}/${expr.local}`;
    if (kind === "tokens" && Object.hasOwn(expr, "tokens")) return expr.tokens;
    issue(items, "invalid", "PARAMETER_TYPE", "El valor tiene un tipo incompatible.", rowId, opId);
    return null;
  }
  function resolveBinding(value, environment, prefix, items, rowId, opId) {
    if (Object.hasOwn(value, "unknown")) {
      issue(items, "incomplete", "UNKNOWN_VALUE", value.unknown, rowId, opId);
      return null;
    }
    if (Object.hasOwn(value, "param")) {
      if (!Object.hasOwn(environment, value.param)) {
        issue(items, "incomplete", "MISSING_PARAMETER", "Falta un parámetro.", rowId, opId, value.param);
        return null;
      }
      return environment[value.param];
    }
    if (Object.hasOwn(value, "local")) return { ref: `${prefix}/${value.local}` };
    return value;
  }
  function append(items, event, rowId) {
    if (eventCount >= MAX_EVENTS) {
      if (eventCount === MAX_EVENTS) issue(items, "invalid", "EXPANSION_LIMIT", "La expansión supera 10000 operaciones.", rowId, event.id);
      eventCount++;
      return;
    }
    eventCount++;
    items.push(event);
  }
  function walk(operations, prefix, env, items, rowId, source, overrides = {}) {
    if (!unique(items, operations, rowId, prefix, "operaciones")) return;
    for (const op of operations) {
      if (eventCount > MAX_EVENTS) return;
      const path = `${prefix}/${op.id}`;
      const origin = { operationId: op.id, motifId: source ? source.id : null, motifVersion: source ? source.version : null };
      if (op.type === "unknown") { issue(items, "incomplete", "UNKNOWN_OPERATION", op.reason, rowId, path); continue; }
      if (op.type === "repeat") {
        if (!unique(items, op.iterations, rowId, path, "iteraciones")) continue;
        const bodyIds = new Set(op.operations.filter(item => item.type === "motif").map(item => item.id));
        for (const iteration of op.iterations) {
          if (eventCount > MAX_EVENTS) break;
          const invalidOverride = Object.keys(iteration.overrides).find(key => !bodyIds.has(key));
          if (invalidOverride) { issue(items, "invalid", "UNKNOWN_OVERRIDE", "La corrección no corresponde a una instancia del motivo.", rowId, path, invalidOverride); continue; }
          const bindings = {};
          let valid = true;
          for (const [key, value] of Object.entries(iteration.bindings)) {
            const resolved = resolveBinding(value, env, prefix, items, rowId, path);
            if (!resolved) valid = false; else bindings[key] = resolved;
          }
          if (valid) walk(op.operations, `${path}/${iteration.id}`, bindings, items, rowId, source, iteration.overrides);
        }
        continue;
      }
      if (op.type === "motif") {
        const definition = definitions.get(`${op.definitionId}@${op.definitionVersion}`);
        if (!definition) { issue(items, "incomplete", "MISSING_MOTIF", "Falta la definición del motivo.", rowId, path, op.definitionId); continue; }
        const supplied = { ...op.bindings, ...(Object.hasOwn(overrides, op.id) ? overrides[op.id] : {}) };
        const extras = Object.keys(supplied).filter(key => !Object.hasOwn(definition.parameters, key));
        if (extras.length) { issue(items, "invalid", "UNKNOWN_PARAMETER", "El motivo recibe un parámetro desconocido.", rowId, path, extras[0]); continue; }
        const bindings = {};
        let valid = true;
        for (const [name, kind] of Object.entries(definition.parameters)) {
          if (!Object.hasOwn(supplied, name)) {
            issue(items, "incomplete", "MISSING_PARAMETER", "Falta un parámetro del motivo.", rowId, path, name); valid = false; continue;
          }
          const resolved = resolveBinding(supplied[name], env, prefix, items, rowId, path);
          if (!resolved) { valid = false; continue; }
          if ((kind === "anchor" && typeof resolved.ref !== "string") || (kind === "tokens" && !Array.isArray(resolved.tokens))) {
            issue(items, "invalid", "PARAMETER_TYPE", "Tipo de parámetro incompatible.", rowId, path, name); valid = false;
          } else bindings[name] = resolved;
        }
        if (valid) walk(definition.operations, path, bindings, items, rowId, definition);
        continue;
      }
      if (["sc", "hdc", "dc", "tr", "slip", "increase"].includes(op.type)) {
        const target = resolve(op.target, "anchor", env, prefix, items, rowId, path);
        if (!target) continue;
        if (op.type === "increase") {
          const tokens = resolve(op.stitchIds, "tokens", env, prefix, items, rowId, path);
          if (!tokens) continue;
          if (tokens.length < 2) { issue(items, "invalid", "INCREASE_SIZE", "Un aumento requiere al menos dos puntos.", rowId, path); continue; }
          for (const token of tokens) append(items, { id: `${path}/${token}`, type: op.stitchType, target, source: origin, group: path, motif: source ? prefix : null, reuse: "increase" }, rowId);
        } else append(items, { id: path, type: op.type, target, source: origin, group: null, motif: source ? prefix : null, reuse: op.reuse || "none" }, rowId);
      } else if (op.type === "chain") {
        const tokens = resolve(op.chainIds, "tokens", env, prefix, items, rowId, path);
        if (!tokens) continue;
        for (const token of tokens) append(items, { id: `${path}/${token}`, type: "chain", role: op.role, source: origin, group: path, motif: source ? prefix : null }, rowId);
      } else if (op.type === "decrease") {
        const targets = op.targets.map(value => resolve(value, "anchor", env, prefix, items, rowId, path));
        if (targets.every(Boolean)) append(items, { id: path, type: "sc2tog", targets, source: origin, group: null, motif: source ? prefix : null }, rowId);
      } else if (op.type === "space") {
        append(items, { id: path, type: "space", chainId: `${prefix}/${op.chainId}`, closureId: `${prefix}/${op.closureId}`, source: origin }, rowId);
      } else if (op.type === "turn") append(items, { id: path, type: "turn", source: origin }, rowId);
    }
  }
  for (const row of document.rows) {
    const items = [];
    if (row.id === "initial") issue(items, "invalid", "RESERVED_ID", "El identificador initial está reservado.", row.id, row.id);
    if (rowIds.has(row.id)) issue(items, "invalid", "DUPLICATE_ROW", "La fila tiene un ID duplicado.", row.id, row.id);
    else rowIds.add(row.id);
    walk(row.operations, row.id, {}, items, row.id, null);
    rows.push({ id: row.id, items });
  }
  return { status: statusOf(diagnostics), diagnostics, rows };
}
