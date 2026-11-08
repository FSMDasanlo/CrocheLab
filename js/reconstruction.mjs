import { execute, applyCorrection } from "./crochet-core/index.mjs";

const LABELS = {
  sc: "punto bajo", hdc: "medio punto alto", dc: "punto alto",
  tr: "punto alto doble", sc2tog: "disminución de dos puntos bajos",
  slip: "punto deslizado", chain: "cadeneta", space: "espacio", turn: "giro"
};
const SYMBOLS = {
  sc: "single-crochet", hdc: "half-double-crochet", dc: "double-crochet",
  tr: "treble-crochet", sc2tog: "decrease", slip: "slip-stitch",
  chain: "chain", space: "chain-space"
};

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

export function createReconstruction(project) {
  if (!project || typeof project.id !== "string" || !Array.isArray(project.photos)) {
    throw new Error("No se pudo identificar el proyecto y sus fotografías.");
  }
  return {
    id: `reconstruction-${project.id}`, projectId: project.id, formatVersion: 1,
    photoRoles: Object.fromEntries(project.photos.map((photo, index) => [photo.id, index === 0 ? "overview" : "detail"])),
    photoReviews: {}, completionConfirmed: false,
    analysisRuns: [], findings: [], materials: "", notes: "", logicalDocument: null,
    operationEvidence: {}, revisions: []
  };
}

export async function analyzePhotos(photos, analyzePhoto, makeId, onProgress) {
  if (!Array.isArray(photos) || !photos.length) throw new Error("Añade al menos una fotografía.");
  if (new Set(photos.map(photo => photo.id)).size !== photos.length) throw new Error("Hay fotografías con identificadores duplicados.");
  const findings = [];
  const results = [];
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    if (onProgress) onProgress(index + 1, photos.length, photo.id);
    try {
      const observed = await analyzePhoto(photo);
      if (!Array.isArray(observed)) throw new Error("El análisis no devolvió una lista de hallazgos.");
      for (const finding of observed) {
        if (finding.photoId !== photo.id) throw new Error("Un hallazgo no corresponde a la fotografía analizada.");
      }
      findings.push(...observed.map(finding => ({
        ...finding, id: makeId(), review: "pending", corrections: []
      })));
      results.push({ photoId: photo.id, status: "analyzed", error: null });
    } catch (error) {
      results.push({ photoId: photo.id, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { findings, results, complete: results.every(result => result.status === "analyzed") };
}

export function reviewFinding(reconstruction, findingId, review, statement, reason, kind, region) {
  if (!["confirmed", "rejected", "pending"].includes(review)) throw new Error("La decisión de revisión no es válida.");
  if (typeof statement !== "string" || !statement.trim()) throw new Error("El hallazgo necesita una descripción.");
  const next = structuredClone(reconstruction);
  const finding = next.findings.find(item => item.id === findingId);
  if (!finding) throw new Error("El hallazgo ya no existe.");
  if (kind !== undefined && !["observation", "inference", "unknown"].includes(kind)) throw new Error("El tipo de hallazgo no es válido.");
  if (region !== undefined && region !== null && (!region || typeof region !== "object" ||
      !["x", "y", "width", "height"].every(key => Number.isFinite(region[key])) ||
      region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
      region.x + region.width > 1 || region.y + region.height > 1)) throw new Error("La zona de evidencia no es válida.");
  const before = { review: finding.review, statement: finding.statement, kind: finding.kind, region: finding.region };
  finding.review = review;
  finding.statement = statement.trim();
  if (kind !== undefined) finding.kind = kind;
  if (region !== undefined) finding.region = region;
  finding.corrections.push({
    origin: "human", before, after: { review, statement: finding.statement, kind: finding.kind, region: finding.region },
    reason: typeof reason === "string" ? reason.trim() : ""
  });
  return next;
}

export function operationSignature(document, operation) {
  return JSON.stringify({
    operation,
    motifs: operation.type === "motif" || operation.type === "repeat" ? document.motifs : []
  });
}

export function findingSignature(finding) {
  return JSON.stringify({
    kind: finding.kind, category: finding.category, statement: finding.statement,
    photoId: finding.photoId, region: finding.region, review: finding.review
  });
}

function instructionsFromTrace(trace, materials, notes) {
  const lines = [
    `Estado: ${trace.status}. La coherencia lógica no garantiza fidelidad ni viabilidad física.`,
    `Materiales: ${materials.trim() || "pendientes de indicar"}.`,
    `Observaciones: ${notes.trim() || "ninguna indicada"}.`
  ];
  if (trace.initialState && trace.initialState.activeLoop) {
    lines.push(`Inicio: bucle ${trace.initialState.activeLoop.id}, asociado a ${trace.initialState.activeLoop.origin.anchor}.`);
  } else lines.push("Inicio pendiente de definir.");
  for (const row of trace.rows) {
    lines.push(`\nFila ${row.id} (${row.directionAfter || "dirección pendiente"}):`);
    const events = trace.events.filter(event => event.rowId === row.id);
    for (const event of events) {
      const targets = event.inputs.filter(input => input.role === "target").map(input => input.id);
      const annotation = event.inputs.some(input => input.reuseReason === "increase") ? " (reutilización por aumento)" :
        event.inputs.some(input => input.reuseReason === "motif_closure") ? " (cierre del motivo)" : "";
      const source = event.source.motifId ? ` [motivo ${event.source.motifId}; ${event.id}]` : ` [${event.id}]`;
      if (event.type === "turn") lines.push(`Girar el tejido.${source}`);
      else if (event.type === "space") lines.push(`Registrar espacio ${event.id}/anchor a partir de la cadena y su cierre.${source}`);
      else if (event.type === "chain") lines.push(`Tejer una cadeneta.${source}`);
      else lines.push(`Tejer ${LABELS[event.type]} en ${targets.join(" y ")}${annotation}.${source}`);
    }
    if (row.counts) {
      lines.push(`Comprobación: ${row.counts.rowCount} puntos según la convención, ${row.counts.chains} cadenetas y ${row.counts.spaces} espacios.`);
    } else lines.push("Recuento pendiente: la fila no se ha ejecutado completamente.");
  }
  for (const diagnostic of trace.diagnostics) lines.push(`${diagnostic.status}: ${diagnostic.message}`);
  return lines.join("\n");
}

function svgFromTrace(trace, catalog, simplified = false) {
  if (!catalog || typeof catalog.render !== "function") throw new Error("No está disponible el catálogo de símbolos.");
  if (trace.events.length > 1000) throw new Error("La traza supera el límite de 1000 operaciones para esta representación.");
  const positions = new Map();
  const nodes = [];
  const rows = new Map(trace.rows.map((row, index) => [row.id, index]));
  const byRow = new Map();
  for (const event of trace.events) {
    const list = byRow.get(event.rowId) || [];
    list.push(event);
    byRow.set(event.rowId, list);
  }
  const maxColumns = Math.max(1, trace.initialState ? trace.initialState.frontier.length : 0,
    ...Array.from(byRow.values(), list => list.length));
  const width = Math.max(480, maxColumns * 92 + 100);
  const height = Math.max(160, (trace.rows.length + 1) * 112 + 40);
  if (trace.initialState) {
    const initialAnchors = [...trace.initialState.frontier];
    if (trace.initialState.activeLoop && !initialAnchors.includes(trace.initialState.activeLoop.origin.anchor)) {
      initialAnchors.push(trace.initialState.activeLoop.origin.anchor);
    }
    initialAnchors.forEach((id, index) => {
      const point = { x: 65 + index * 92, y: 35 };
      positions.set(id, point);
      nodes.push(`<g data-anchor-id="${escapeXml(id)}"><circle cx="${point.x}" cy="${point.y}" r="5"/>${simplified ? "" : `<text x="${point.x}" y="${point.y - 10}" text-anchor="middle">${escapeXml(id)}</text>`}</g>`);
    });
  }
  for (const event of trace.events) {
    const list = byRow.get(event.rowId);
    const point = { x: 65 + list.indexOf(event) * 92, y: 135 + rows.get(event.rowId) * 112 };
    positions.set(event.id, point);
    for (const produced of event.produced) positions.set(produced.id, point);
  }
  const edges = [];
  for (const event of trace.events) {
    const from = positions.get(event.id);
    for (const link of event.connections) {
      if (!["works_into", "follows", "starts_at", "closed_at", "bounded_by"].includes(link.type)) continue;
      const to = positions.get(link.to);
      if (!to) throw new Error(`No se puede representar la relación con ${link.to}.`);
      if (from.x === to.x && from.y === to.y) {
        edges.push(`<path data-relation="${link.type}" data-from="${escapeXml(link.from)}" data-to="${escapeXml(link.to)}" d="M ${from.x} ${from.y} c 24 -30 36 30 0 0"/>`);
        continue;
      }
      edges.push(`<line data-relation="${link.type}" data-from="${escapeXml(link.from)}" data-to="${escapeXml(link.to)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`);
    }
    const symbol = SYMBOLS[event.type];
    const art = symbol
      ? `<g transform="translate(${from.x - 24} ${from.y - 24})">${catalog.render(symbol, 48)}</g>`
      : `<text x="${from.x}" y="${from.y}" text-anchor="middle">giro</text>`;
    nodes.push(`<g data-event-id="${escapeXml(event.id)}"><title>${escapeXml(LABELS[event.type])}</title>${art}${simplified ? "" : `<text x="${from.x}" y="${from.y + 38}" text-anchor="middle">${escapeXml(event.id)}</text>`}</g>`);
  }
  const status = trace.status === "valid" ? "Traza lógica; no garantiza fidelidad a la prenda" : `Traza parcial: ${trace.status}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(status)}"><title>${escapeXml(status)}</title><g fill="none" stroke="#887988" stroke-width="1">${edges.join("")}</g><g stroke="#463b46" fill="#463b46" font-size="9">${nodes.join("")}</g></svg>`;
}

export function automaticTraceOutputs(trace, catalog) {
  const lines = ["Propuesta automática sin revisión humana. La coherencia lógica no garantiza fidelidad ni viabilidad física."];
  if (!trace.initialState || !trace.initialState.activeLoop) lines.push("El inicio del tejido no se ha podido determinar.");
  else lines.push("Inicio: se parte de un bucle activo; su preparación no está especificada.");
  for (const [index, row] of trace.rows.entries()) {
    const direction = row.directionAfter === "right_to_left" ? "de derecha a izquierda" :
      row.directionAfter === "left_to_right" ? "de izquierda a derecha" : "dirección pendiente";
    lines.push(`\nFila ${index + 1} (${direction}):`);
    for (const event of trace.events.filter(item => item.rowId === row.id)) {
      if (event.type === "turn") { lines.push("Gira el tejido."); continue; }
      if (event.type === "chain") { lines.push("Teje una cadeneta."); continue; }
      if (event.type === "space") { lines.push("Forma el espacio entre las cadenetas y su cierre."); continue; }
      const inputs = event.inputs.filter(input => input.role === "target").map(input => {
        const position = row.inputFrontier.indexOf(input.id);
        return position >= 0 ? `entrada ${position + 1} ${index === 0 ? "de la base inicial" : "de la fila anterior"}` : "anclaje trabajado en esta fila";
      });
      const extra = event.inputs.some(input => input.reuseReason === "increase") ? " (aumento en la misma entrada)" :
        event.inputs.some(input => input.reuseReason === "motif_closure") ? " (cierre del motivo)" : "";
      lines.push(`Teje ${LABELS[event.type]}${inputs.length ? ` en ${inputs.join(" y ")}` : ""}${extra}.`);
    }
    if (row.counts) lines.push(`Comprobación: ${row.counts.rowCount} puntos, ${row.counts.chains} cadenetas y ${row.counts.spaces} espacios.`);
    else lines.push("No se puede calcular el recuento completo de esta fila.");
  }
  for (const issue of trace.diagnostics) lines.push(`Pendiente: ${issue.message}`);
  return { instructions: lines.join("\n"), svg: svgFromTrace(trace, catalog, true) };
}

export function deriveOutputs(reconstruction, catalog) {
  if (!reconstruction.logicalDocument) {
    return { status: "incomplete", trace: null, instructions: "Construcción lógica pendiente.", svg: null, diagnostics: ["Falta la construcción lógica."] };
  }
  const trace = execute(reconstruction.logicalDocument);
  const confirmed = new Map(reconstruction.findings.filter(finding => finding.review === "confirmed" && finding.kind !== "unknown").map(finding => [finding.id, finding]));
  const missingEvidence = [];
  for (const row of Array.isArray(reconstruction.logicalDocument.rows) ? reconstruction.logicalDocument.rows : []) {
    for (const operation of row && Array.isArray(row.operations) ? row.operations : []) {
      if (!operation || typeof operation !== "object") continue;
      if (operation.type === "turn" || operation.type === "space" || operation.type === "unknown") continue;
      const path = `${row.id}/${operation.id}`;
      const evidence = reconstruction.operationEvidence[path];
      if (!evidence || evidence.signature !== operationSignature(reconstruction.logicalDocument, operation) ||
          !Array.isArray(evidence.findingIds) || !evidence.findingIds.length ||
          evidence.findingIds.some(id => !confirmed.has(id) || !evidence.findingSignatures ||
            evidence.findingSignatures[id] !== findingSignature(confirmed.get(id)))) missingEvidence.push(path);
    }
  }
  const evidenceMissing = missingEvidence.length > 0;
  const latestPhotoResults = new Map();
  for (const run of reconstruction.analysisRuns) for (const item of run.results) latestPhotoResults.set(item.photoId, item.status);
  const photosPending = Object.keys(reconstruction.photoRoles).filter(id =>
    latestPhotoResults.get(id) !== "analyzed" && reconstruction.photoReviews[id] !== true);
  const findingsPending = reconstruction.findings.filter(finding =>
    finding.review === "pending" || (finding.kind === "unknown" && finding.review !== "rejected"));
  const reviewIncomplete = photosPending.length > 0 || findingsPending.length > 0 || !reconstruction.completionConfirmed;
  let status = trace.status === "invalid" ? "invalid" : evidenceMissing || reviewIncomplete ? "incomplete" : trace.status;
  const diagnostics = trace.diagnostics.map(item => item.message);
  if (evidenceMissing) diagnostics.push(`Asocia a hallazgos confirmados: ${missingEvidence.join(", ")}. La correspondencia con la prenda requiere revisión.`);
  if (photosPending.length) diagnostics.push(`Fotografías pendientes de análisis o revisión manual: ${photosPending.join(", ")}.`);
  if (findingsPending.length) diagnostics.push(`Hay ${findingsPending.length} hallazgos o incógnitas pendientes.`);
  if (!reconstruction.completionConfirmed) diagnostics.push("La revisión humana de la construcción no se ha marcado como completa.");
  let svg = null;
  try {
    svg = svgFromTrace({ ...trace, status }, catalog);
  } catch (error) {
    diagnostics.push(`No se puede generar la representación: ${error.message}`);
    if (status === "valid") status = "incomplete";
  }
  return {
    status, trace,
    instructions: instructionsFromTrace({ ...trace, status }, reconstruction.materials, reconstruction.notes),
    svg,
    diagnostics
  };
}

export function correctLogicalDocument(reconstruction, correction) {
  if (!reconstruction.logicalDocument) throw new Error("No hay construcción lógica que corregir.");
  const result = applyCorrection(reconstruction.logicalDocument, correction);
  if (!result.applied) throw new Error(result.diagnostics.map(item => item.message).join(" "));
  return { reconstruction: { ...reconstruction, logicalDocument: result.document }, result };
}
