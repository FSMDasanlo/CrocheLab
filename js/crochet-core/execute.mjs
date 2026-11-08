import { ENGINE_VERSION, diagnostic, statusOf } from "./model.mjs";
import { expand } from "./expand.mjs";
import { calculateCounts } from "./counts.mjs";

function item(id, kind, stitchType = null, role = null) { return { id, kind, stitchType, role }; }
function connection(type, from, to) { return { type, from, to }; }

export function execute(document) {
  const expanded = expand(document);
  const diagnostics = [...expanded.diagnostics];
  const result = { engineVersion: ENGINE_VERSION, status: "valid", initialState: null, diagnostics, events: [], rows: [] };
  if (!expanded.rows.length && diagnostics.length) { result.status = statusOf(diagnostics); return result; }
  function problem(status, code, message, rowId = null, operationId = null, reference = null) {
    diagnostics.push(diagnostic(status, code, message, rowId, operationId, reference));
  }
  const anchors = new Map();
  const producers = new Map();
  for (const anchor of document.initial.anchors) {
    const id = `initial/${anchor.id}`;
    if (anchors.has(id)) problem("invalid", "DUPLICATE_ANCHOR", "Anclaje inicial duplicado.", null, null, id);
    anchors.set(id, { kind: anchor.kind, producer: null, exportKey: null });
  }
  let frontier = [...document.initial.frontier];
  for (const id of frontier) {
    if (!anchors.has(id)) problem("invalid", "UNKNOWN_ANCHOR", "La frontera inicial contiene una referencia inexistente.", null, null, id);
    else if (anchors.get(id).kind === "edge") problem("invalid", "INVALID_FRONTIER", "Un borde de contexto no es un anclaje de pasada.", null, null, id);
  }
  const initialLoop = document.initial.activeLoop;
  let loop = initialLoop ? `initial/${initialLoop.id}` : null;
  let loopAt = initialLoop ? initialLoop.origin.anchor : null;
  result.initialState = {
    direction: document.initial.direction,
    frontier: [...frontier],
    activeLoop: initialLoop ? { id: loop, origin: { kind: initialLoop.origin.kind, anchor: loopAt } } : null
  };
  if (!initialLoop) problem("incomplete", "MISSING_LOOP", "Falta el bucle activo inicial.");
  if (loop && anchors.has(loop)) problem("invalid", "DUPLICATE_ID", "El bucle inicial y un anclaje comparten identificador.", null, null, loop);
  if (loopAt && !anchors.has(loopAt)) problem("invalid", "UNKNOWN_LOOP_ORIGIN", "El origen del bucle no existe.", null, null, loopAt);
  let direction = document.initial.direction;
  if (direction === null) problem("incomplete", "MISSING_DIRECTION", "Falta la dirección inicial.");
  if (!document.rows.length) problem("incomplete", "MISSING_ROWS", "No hay filas definidas.");
  if (diagnostics.some(d => d.rowId === null)) { result.status = statusOf(diagnostics); return result; }
  let previousEvent = null;
  for (let rowIndex = 0; rowIndex < document.rows.length; rowIndex++) {
    const row = document.rows[rowIndex];
    const inputFrontier = [...frontier];
    const loopBefore = loop;
    const used = new Map();
    const chainGroups = new Map();
    const rowEvents = [];
    let lastInputIndex = -1;
    let failed = false;
    let directionChecked = false;
    const record = { id: row.id, status: "valid", inputFrontier, outputFrontier: null, directionBefore: direction, directionAfter: null, loopBefore, loopAfter: null, counts: null };
    result.rows.push(record);
    function fail(status, code, message, operationId = null, reference = null) {
      problem(status, code, message, row.id, operationId, reference);
      failed = true;
    }
    function useTarget(id, op, staged) {
      const anchor = anchors.get(id);
      if (!anchor) { fail("invalid", "UNKNOWN_ANCHOR", "El anclaje no existe.", op.id, id); return null; }
      const index = inputFrontier.indexOf(id);
      if (index < 0 && !rowEvents.some(event => event.id === anchor.producer)) {
        fail("invalid", "ANCHOR_NOT_AVAILABLE", "El anclaje no está disponible en esta fila.", op.id, id); return null;
      }
      const previous = staged.get(id) || used.get(id);
      if (previous) {
        const increaseReuse = op.reuse === "increase" && previous.group === op.group;
        const last = rowEvents[rowEvents.length - 1];
        const closureReuse = op.reuse === "motif_closure" && op.motif && previous.motif === op.motif &&
          last && last.type === "chain" && last.id.startsWith(`${op.motif}/`);
        if (!increaseReuse && !closureReuse) { fail("invalid", "ANCHOR_REUSED", "El anclaje se reutiliza sin una regla admitida.", op.id, id); return null; }
        staged.set(id, previous);
        return index >= 0 ? "reuse" : "internal_reuse";
      }
      if (op.reuse === "motif_closure") {
        fail("invalid", "INVALID_CLOSURE", "El cierre no reutiliza un anclaje del mismo motivo.", op.id, id); return null;
      }
      if (index >= 0) {
        if (index <= lastInputIndex) { fail("invalid", "INVALID_ORDER", "El recorrido de anclajes no sigue la frontera.", op.id, id); return null; }
        lastInputIndex = index;
      }
      staged.set(id, { group: op.group, motif: op.motif });
      return index >= 0 ? "first" : "internal_first";
    }
    if (rowIndex > 0 && (!expanded.rows[rowIndex].items[0] || expanded.rows[rowIndex].items[0].type !== "turn")) {
      fail("invalid", "MISSING_TURN", "Las filas de ida y vuelta requieren un giro explícito.", row.id);
    }
    for (const op of expanded.rows[rowIndex].items) {
      if (failed) break;
      if (op.type === "issue") { failed = true; break; }
      if (row.direction === null) { fail("incomplete", "MISSING_DIRECTION", "Falta la dirección de la fila.", op.id); break; }
      const directionBefore = direction;
      if (op.type === "turn") {
        if (rowEvents.length !== 0 || op.id !== `${row.id}/${op.source.operationId}`) {
          fail("invalid", "INVALID_TURN", "El giro solo se admite al comienzo de una fila.", op.id); break;
        }
        direction = direction === "left_to_right" ? "right_to_left" : "left_to_right";
      } else if (!directionChecked) {
        if (direction !== row.direction) { fail("invalid", "DIRECTION_MISMATCH", "La dirección requiere un giro explícito.", op.id); break; }
        directionChecked = true;
      }
      const staged = new Map();
      const inputs = [];
      if (["sc", "hdc", "dc", "tr", "slip"].includes(op.type)) {
        const usage = useTarget(op.target, op, staged);
        if (failed) break;
        inputs.push({ id: op.target, role: "target", usage, reuseReason: usage === "reuse" || usage === "internal_reuse" ? op.reuse : null });
      }
      if (op.type === "sc2tog") {
        const indexes = op.targets.map(id => inputFrontier.indexOf(id));
        if (indexes[0] < 0 || indexes[1] !== indexes[0] + 1 || op.targets[0] === op.targets[1]) {
          fail("invalid", "DECREASE_INPUTS", "La disminución requiere dos entradas consecutivas y distintas.", op.id); break;
        }
        for (const target of op.targets) {
          const usage = useTarget(target, op, staged);
          if (failed) break;
          inputs.push({ id: target, role: "target", usage, reuseReason: null });
        }
        if (failed) break;
      }
      let chainGroup;
      let closure;
      if (op.type === "space") {
        chainGroup = chainGroups.get(op.chainId);
        closure = rowEvents[rowEvents.length - 1];
        const beforeClosure = rowEvents[rowEvents.length - 2];
        if (!chainGroup || !closure || closure.id !== op.closureId || closure.type !== "slip" ||
            !beforeClosure || beforeClosure.id !== chainGroup.events[chainGroup.events.length - 1].id) {
          fail("invalid", "INVALID_SPACE", "El espacio necesita una cadena y un cierre consecutivos y explícitos.", op.id); break;
        }
        for (const chainEvent of chainGroup.events) inputs.push({ id: `${chainEvent.id}/chain`, role: "chain", usage: "none", reuseReason: null });
        inputs.push({ id: `${closure.id}/point`, role: "closure", usage: "none", reuseReason: null });
      }
      const event = {
        id: op.id, rowId: row.id, type: op.type, source: op.source, inputs,
        directionBefore, directionAfter: direction,
        loopBefore: loop, loopAfter: loop, produced: [], connections: [], dependsOn: []
      };
      const dependencies = new Set();
      if (previousEvent) dependencies.add(previousEvent);
      if (producers.has(loop)) dependencies.add(producers.get(loop));
      for (const input of inputs) if (producers.has(input.id)) dependencies.add(producers.get(input.id));
      event.dependsOn = [...dependencies];
      if (["sc", "hdc", "dc", "tr", "sc2tog", "slip"].includes(op.type)) {
        const point = `${op.id}/point`;
        const top = `${op.id}/top`;
        const nextLoop = `${op.id}/loop`;
        event.produced.push(item(point, "stitch", op.type), item(top, "stitch_anchor", op.type), item(nextLoop, "active_loop"));
        for (const input of inputs) event.connections.push(connection("works_into", point, input.id));
        event.connections.push(connection("anchor_of", top, point));
        event.connections.push(connection("loop_at", nextLoop, top));
        anchors.set(top, { kind: "stitch", producer: op.id, exportKey: `${op.type}.top` });
        loop = nextLoop; loopAt = top; event.loopAfter = loop;
      } else if (op.type === "chain") {
        const chain = `${op.id}/chain`;
        const anchor = `${op.id}/anchor`;
        const nextLoop = `${op.id}/loop`;
        event.produced.push(item(chain, "chain", null, op.role), item(anchor, "chain_anchor", null, op.role), item(nextLoop, "active_loop"));
        event.connections.push(connection("anchor_of", anchor, chain));
        let group = chainGroups.get(op.group);
        if (!group) { group = { events: [], start: loopAt }; chainGroups.set(op.group, group); }
        if (group.events.length) event.connections.push(connection("follows", chain, `${group.events[group.events.length - 1].id}/chain`));
        else event.connections.push(connection("starts_at", chain, loopAt));
        event.connections.push(connection("loop_at", nextLoop, anchor));
        anchors.set(anchor, { kind: "chain", producer: op.id, exportKey: "chain.anchor" });
        group.events.push(event);
        loop = nextLoop; loopAt = anchor; event.loopAfter = loop;
      } else if (op.type === "space") {
        const space = `${op.id}/space`;
        const anchor = `${op.id}/anchor`;
        event.produced.push(item(space, "space"), item(anchor, "space_anchor"));
        event.connections.push(connection("anchor_of", anchor, space));
        event.connections.push(connection("starts_at", space, chainGroup.start));
        for (const chainEvent of chainGroup.events) event.connections.push(connection("bounded_by", space, `${chainEvent.id}/chain`));
        event.connections.push(connection("closed_at", space, `${closure.id}/point`));
        event.connections.push(connection("closed_at", space, closure.inputs[0].id));
        anchors.set(anchor, { kind: "space", producer: op.id, exportKey: "space.anchor" });
      }
      for (const [id, usage] of staged) used.set(id, usage);
      for (const produced of event.produced) producers.set(produced.id, op.id);
      result.events.push(event);
      rowEvents.push(event);
      previousEvent = event.id;
    }
    if (!failed && !rowEvents.length) fail("incomplete", "EMPTY_ROW", "La fila no contiene operaciones.");
    if (!failed && direction !== row.direction) fail("invalid", "DIRECTION_MISMATCH", "La dirección de la fila no coincide con el recorrido.");
    if (!failed && rowIndex < document.rows.length - 1 && row.nextPass.order !== "reverse") {
      fail("invalid", "FRONTIER_ORDER", "La siguiente fila de ida y vuelta necesita invertir el orden de la frontera.");
    }
    if (!failed) {
      const carry = new Set(row.nextPass.carry);
      const skip = new Set(row.nextPass.skip);
      for (const id of [...carry, ...skip]) {
        if (!inputFrontier.includes(id) || used.has(id) || (carry.has(id) && skip.has(id))) {
          fail("invalid", "INVALID_DISPOSITION", "Solo se pueden conservar u omitir entradas disponibles y no utilizadas.", null, id); break;
        }
      }
      if (!failed) {
        for (const id of inputFrontier) {
          if (!used.has(id) && !carry.has(id) && !skip.has(id)) {
            fail("incomplete", "UNRESOLVED_INPUT", "Una entrada no utilizada debe conservarse u omitirse explícitamente.", null, id); break;
          }
        }
      }
      if (!failed) {
        const output = [];
        for (const event of rowEvents) {
          for (const produced of event.produced) {
            const anchor = anchors.get(produced.id);
            if (anchor && row.nextPass.export.includes(anchor.exportKey)) output.push(produced.id);
          }
        }
        output.push(...row.nextPass.carry);
        if (row.nextPass.order === "reverse") output.reverse();
        frontier = output;
        record.outputFrontier = [...frontier];
        record.directionAfter = direction;
        record.loopAfter = loop;
        record.counts = calculateCounts(rowEvents, inputFrontier, frontier, anchors, document.conventions);
      }
    }
    if (failed) {
      record.status = statusOf(diagnostics.filter(d => d.rowId === row.id));
      if (record.status === "valid") record.status = "incomplete";
      if (rowIndex < document.rows.length - 1) problem("incomplete", "PREVIOUS_ROW_UNAVAILABLE", "Las filas posteriores no se ejecutaron.", document.rows[rowIndex + 1].id);
      break;
    }
  }
  result.status = statusOf(diagnostics);
  return result;
}
