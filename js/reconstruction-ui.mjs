import { execute } from "./crochet-core/index.mjs";
import {
  analyzePhotos, correctLogicalDocument, createReconstruction, deriveOutputs,
  findingSignature, operationSignature, reviewFinding
} from "./reconstruction.mjs";

const bridge = window.CrocheLabReconstructionBridge;
const catalog = window.CrocheLabSymbols;
const ai = window.CrocheLabAI;
const page = document.getElementById("reconstruction-tool");
const el = name => document.getElementById(`reconstruction-${name}`);
const escape = value => String(value).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const newId = prefix => prefix + crypto.randomUUID();
let projectId = "";
let context = null;
let projectSnapshot;
let saved;
let draft;
let selectedPhoto = null;
let region = null;
let photoUrl = null;
let dirty = false;
let jsonDirty = false;
let pendingFindings = new Map();
let busy = false;
let sequence = 0;

function message(text, error = false) {
  el("status").textContent = text;
  el("status").classList.toggle("error", error);
}

function project() {
  return bridge.projects().find(item => item.id === projectId) || null;
}

function current() {
  return Boolean(draft && context && bridge.isCurrent(context) && project());
}

function requireCurrent(options = {}) {
  if (!current()) throw new Error("El proyecto o el espacio cambió. Conserva el borrador y vuelve a cargar el proyecto.");
  if (jsonDirty) throw new Error("Aplica o descarta primero la edición JSON pendiente.");
  if (!options.allowFindings && pendingFindings.size) throw new Error("Aplica primero las revisiones de hallazgos pendientes.");
  if (!options.allowManual && el("manual-finding").value.trim()) throw new Error("Añade o borra la observación humana pendiente.");
}

function findFinding(id) {
  return draft.findings.find(finding => finding.id === id);
}

function evidenceFor(path, operation) {
  const finding = findFinding(el("evidence").value);
  if (!finding || finding.review !== "confirmed" || finding.kind === "unknown") {
    throw new Error("Selecciona un hallazgo confirmado que respalde esta operación.");
  }
  draft.operationEvidence[path] = {
    findingIds: [finding.id],
    findingSignatures: { [finding.id]: findingSignature(finding) },
    signature: operationSignature(draft.logicalDocument, operation)
  };
}

function captureVersion() {
  return {
    id: newId("v"), createdAt: new Date().toISOString(),
    photoRoles: structuredClone(draft.photoRoles),
    photoReviews: structuredClone(draft.photoReviews),
    completionConfirmed: draft.completionConfirmed,
    analysisRuns: structuredClone(draft.analysisRuns),
    findings: structuredClone(draft.findings),
    materials: draft.materials,
    notes: draft.notes,
    logicalDocument: structuredClone(draft.logicalDocument),
    operationEvidence: structuredClone(draft.operationEvidence),
    outputs: deriveOutputs(draft, catalog)
  };
}

function checkpoint() {
  if (draft.logicalDocument) draft.revisions.push(captureVersion());
}

function advanceRevision(document) {
  document.revision = { id: newId("r"), parentId: document.revision.id, change: null };
}

function validateSaved(value, id) {
  if (!value || value.formatVersion !== 1 || value.id !== `reconstruction-${id}` || value.projectId !== id ||
      !Array.isArray(value.findings) || !Array.isArray(value.analysisRuns) || !Array.isArray(value.revisions) ||
      !value.photoRoles || typeof value.photoRoles !== "object" || !value.photoReviews ||
      typeof value.photoReviews !== "object" || typeof value.completionConfirmed !== "boolean" || !value.operationEvidence ||
      typeof value.operationEvidence !== "object" || typeof value.materials !== "string" || typeof value.notes !== "string") {
    throw new Error("La reconstrucción guardada tiene un formato incompatible; no se modificará.");
  }
}

function refreshProjects() {
  const list = bridge.projects();
  const select = el("project");
  select.innerHTML = '<option value="">Selecciona un proyecto…</option>' +
    list.map(item => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  if (projectId && !list.some(item => item.id === projectId)) {
    select.insertAdjacentHTML("beforeend", `<option value="${escape(projectId)}">Proyecto anterior no disponible</option>`);
  }
  select.value = projectId;
  if (draft && !current()) message("El espacio o proyecto cambió. El borrador sigue en esta página, pero no se puede guardar aquí.", true);
}

function renderPhoto() {
  const viewer = el("photo-viewer");
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = null;
  viewer.replaceChildren();
  const selected = project() && project().photos.find(photo => photo.id === selectedPhoto);
  if (!selected) { viewer.textContent = "Selecciona una fotografía."; return; }
  const image = document.createElement("img");
  image.alt = selected.label || selected.name || "Fotografía de referencia";
  if (selected.blob instanceof Blob) { photoUrl = URL.createObjectURL(selected.blob); image.src = photoUrl; }
  else if (selected.downloadUrl) image.src = selected.downloadUrl;
  else { viewer.textContent = "No se puede cargar esta fotografía."; return; }
  const frame = document.createElement("div");
  frame.className = "reconstruction-photo-frame";
  frame.appendChild(image);
  if (region) {
    const marker = document.createElement("span");
    marker.className = "reconstruction-region";
    marker.style.left = `${region.x * 100}%`;
    marker.style.top = `${region.y * 100}%`;
    marker.style.width = `${region.width * 100}%`;
    marker.style.height = `${region.height * 100}%`;
    marker.setAttribute("aria-label", "Región asociada al hallazgo");
    frame.appendChild(marker);
  }
  viewer.appendChild(frame);
}

function renderPhotos() {
  const photos = project() ? project().photos : [];
  el("photos").innerHTML = photos.map(photo => {
    const role = draft.photoRoles[photo.id] || "other";
    const choices = [["overview", "General"], ["detail", "Detalle"], ["border", "Borde"], ["repeat", "Repetición"], ["join", "Unión"], ["other", "Otra"]]
      .map(([value, name]) => `<option value="${value}"${value === role ? " selected" : ""}>${name}</option>`).join("");
    return `<div class="reconstruction-photo-row"><button type="button" class="button button-quiet" data-photo="${escape(photo.id)}">${escape(photo.label || photo.name || "Fotografía")}</button>` +
      `<label>Tipo <select data-photo-role="${escape(photo.id)}">${choices}</select></label>` +
      `<label><input type="checkbox" data-photo-reviewed="${escape(photo.id)}"${draft.photoReviews[photo.id] ? " checked" : ""}> Revisada manualmente</label></div>`;
  }).join("");
  renderPhoto();
}

function renderFindings() {
  el("findings").innerHTML = draft.findings.map(finding => {
    const options = [["pending", "Pendiente"], ["confirmed", "Confirmado"], ["rejected", "Rechazado"]]
      .map(([value, label]) => `<option value="${value}"${finding.review === value ? " selected" : ""}>${label}</option>`).join("");
    const kinds = [["observation", "Observación"], ["inference", "Inferencia"], ["unknown", "Incógnita"]]
      .map(([value, label]) => `<option value="${value}"${finding.kind === value ? " selected" : ""}>${label}</option>`).join("");
    return `<article class="reconstruction-finding" data-finding="${escape(finding.id)}">` +
      `<p><strong>${escape(finding.kind)} · ${escape(finding.category)}</strong> · confianza ${escape(finding.confidence)} · ${escape(finding.origin || "ai")}</p>` +
      `<button class="button button-quiet" type="button" data-show-finding="${escape(finding.id)}">Ver fotografía y zona</button>` +
      `<label class="field"><span>Interpretación revisable</span><textarea data-finding-statement rows="2">${escape(finding.statement)}</textarea></label>` +
      `<label class="field"><span>Tipo</span><select data-finding-kind>${kinds}</select></label>` +
      `<label class="field"><span>Decisión</span><select data-finding-review>${options}</select></label>` +
      `<fieldset><legend>Zona en la foto (proporciones de 0 a 1; vacías para toda la foto)</legend>` +
      ["x", "y", "width", "height"].map(name => `<label>${escape(name)} <input type="number" step="0.01" min="0" max="1" data-finding-${name} value="${finding.region ? escape(finding.region[name]) : ""}"></label>`).join("") + `</fieldset>` +
      `<label class="field"><span>Motivo de la corrección (opcional)</span><input data-finding-reason></label>` +
      `<button class="button button-secondary" type="button" data-review-finding="${escape(finding.id)}">Aplicar revisión</button></article>`;
  }).join("");
  for (const card of el("findings").querySelectorAll("[data-finding]")) {
    const pending = pendingFindings.get(card.dataset.finding);
    if (!pending) continue;
    for (const name of ["statement", "kind", "review", "reason", "x", "y", "width", "height"]) card.querySelector(`[data-finding-${name}]`).value = pending[name];
  }
  const previous = el("evidence").value;
  el("evidence").innerHTML = '<option value="">Selecciona un hallazgo…</option>' +
    draft.findings.filter(finding => finding.review === "confirmed" && finding.kind !== "unknown")
      .map(finding => `<option value="${escape(finding.id)}">${escape(finding.statement)}</option>`).join("");
  if (Array.from(el("evidence").options).some(option => option.value === previous)) el("evidence").value = previous;
}

function renderOperations() {
  const document = draft.logicalDocument;
  const rows = document && Array.isArray(document.rows) ? document.rows.filter(item => item && typeof item.id === "string") : [];
  const previous = el("row-select").value;
  el("row-select").innerHTML = rows.map(row => `<option value="${escape(row.id)}">${escape(row.id)}</option>`).join("");
  if (rows.some(row => row.id === previous)) el("row-select").value = previous;
  const row = rows.find(item => item.id === el("row-select").value);
  if (!row || !Array.isArray(row.operations)) {
    el("operations").textContent = "Todavía no hay operaciones.";
    el("frontier").textContent = "";
    return;
  }
  el("operations").innerHTML = row.operations.map((operation, index) => !operation || typeof operation !== "object"
    ? `<div>Operación ${index + 1} mal formada; corrígela en el editor JSON.</div>` :
    `<div class="reconstruction-operation"><code>${escape(operation.id)} · ${escape(operation.type)}</code>` +
    ` <button type="button" data-link-operation="${escape(operation.id)}">Vincular hallazgo seleccionado</button>` +
    ` <button type="button" data-move-operation="${escape(operation.id)}" data-direction="-1" aria-label="Subir operación">↑</button>` +
    ` <button type="button" data-move-operation="${escape(operation.id)}" data-direction="1" aria-label="Bajar operación">↓</button>` +
    ` <button type="button" data-remove-operation="${escape(operation.id)}">Quitar</button>` +
    `<small> ${index + 1}</small></div>`).join("");
  const trace = execute(document);
  const rowResult = trace.rows.find(item => item.id === row.id);
  const previousRow = rows[rows.indexOf(row) - 1];
  const previousResult = previousRow && trace.rows.find(item => item.id === previousRow.id);
  const frontier = rowResult ? rowResult.inputFrontier : previousResult && previousResult.outputFrontier;
  el("frontier").textContent = frontier ? `Entradas disponibles: ${frontier.join(", ") || "ninguna"}` : "La frontera de esta fila todavía no está disponible.";
}

function renderOutputs() {
  const output = deriveOutputs(draft, catalog);
  el("complete").checked = draft.completionConfirmed;
  el("validation").textContent = `Estado: ${output.status}. ${output.diagnostics.join(" ")}`;
  el("instructions").textContent = output.instructions;
  el("svg").innerHTML = output.svg || "";
}

function renderAnalysisStatus() {
  const latest = new Map();
  for (const run of draft.analysisRuns) for (const result of run.results) latest.set(result.photoId, result);
  if (!latest.size) { el("analysis-status").textContent = "Todavía no se han analizado fotografías."; return; }
  const failures = Array.from(latest.values()).filter(result => result.status === "failed");
  el("analysis-status").textContent = failures.length
    ? `Análisis incompleto. Fallaron: ${failures.map(item => `${item.photoId}: ${item.error}`).join("; ")}`
    : `Se analizaron ${latest.size} fotografías. Revisa los hallazgos antes de usarlos.`;
}

function render() {
  if (!draft) return;
  renderPhotos();
  renderAnalysisStatus();
  renderFindings();
  renderOperations();
  renderOutputs();
  if (!jsonDirty) el("json").value = draft.logicalDocument ? JSON.stringify(draft.logicalDocument, null, 2) : "";
  el("materials").value = draft.materials;
  el("notes").value = draft.notes;
  el("complete").checked = draft.completionConfirmed;
  const active = current() && !busy;
  el("analyze").disabled = !active || !ai || !ai.isConfigured() || !project().photos.length;
  for (const name of ["add-photos", "add-finding", "base", "row", "add-operation", "apply-json", "reset-json", "correct", "save"]) el(name).disabled = !active;
  el("versions").innerHTML = draft.revisions.map(version =>
    `<option value="${escape(version.id)}">${escape(version.createdAt)} · ${escape(version.id)}</option>`).join("");
  el("restore").disabled = !active || !draft.revisions.length;
}

async function load(id) {
  const loadSequence = ++sequence;
  const loadContext = bridge.context();
  const expectedProject = bridge.projectSnapshot(id);
  if (expectedProject === undefined) throw new Error("No se pudo verificar el proyecto.");
  const value = await bridge.get(id, loadContext);
  if (loadSequence !== sequence || !bridge.isCurrent(loadContext)) throw new Error("El proyecto o el espacio cambió durante la carga.");
  const selected = bridge.projects().find(item => item.id === id);
  if (!selected) throw new Error("El proyecto ya no está disponible.");
  if (value) validateSaved(value, id);
  projectId = id;
  context = loadContext;
  projectSnapshot = expectedProject;
  saved = value;
  draft = value ? structuredClone(value) : createReconstruction(selected);
  for (const photo of selected.photos) {
    if (!Object.hasOwn(draft.photoRoles, photo.id)) draft.photoRoles[photo.id] = "detail";
  }
  selectedPhoto = selected.photos[0] ? selected.photos[0].id : null;
  region = null;
  dirty = false;
  jsonDirty = false;
  pendingFindings = new Map();
  el("manual-finding").value = "";
  refreshProjects();
  render();
  message(value ? "Reconstrucción cargada." : "Proyecto cargado; todavía no hay reconstrucción guardada.");
}

async function withBusy(action) {
  if (busy) return;
  busy = true;
  const controls = Array.from(page.querySelectorAll("button, input, select, textarea"));
  const states = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try { await action(); }
  catch (error) { console.error("Reconstrucción:", error); message(error.message || String(error), true); }
  finally {
    busy = false;
    controls.forEach((control, index) => { control.disabled = states[index]; });
    if (draft) render();
  }
}

function perform(action) {
  if (busy) return;
  try { action(); }
  catch (error) { console.error("Reconstrucción:", error); message(error.message || String(error), true); }
}

function rowAndOperation() {
  const logical = draft.logicalDocument;
  const row = logical && Array.isArray(logical.rows) && logical.rows.find(item => item.id === el("row-select").value);
  if (!row || !Array.isArray(row.operations)) throw new Error("Selecciona una fila válida.");
  return row;
}

function numberFrom(name, minimum) {
  const raw = el(name).value;
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < minimum || value > 200) throw new Error(`Indica una cantidad entre ${minimum} y 200.`);
  return value;
}

function unusedId(items, prefix) {
  let number = 1;
  while (items.some(item => item.id === `${prefix}${number}`)) number++;
  return `${prefix}${number}`;
}

el("project").addEventListener("change", () => {
  const id = el("project").value;
  if ((dirty || jsonDirty) && !window.confirm("Hay cambios sin guardar. ¿Descartarlos y cambiar de proyecto?")) {
    el("project").value = projectId; return;
  }
  if (!id) {
    projectId = ""; draft = null; saved = undefined; selectedPhoto = null; dirty = false; jsonDirty = false;
    pendingFindings = new Map(); el("manual-finding").value = "";
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    for (const name of ["photos", "photo-viewer", "findings", "operations", "frontier", "validation", "instructions", "svg", "versions"]) el(name).replaceChildren();
    for (const name of ["json", "materials", "notes"]) el(name).value = "";
    el("complete").checked = false;
    for (const name of ["analyze", "add-photos", "add-finding", "base", "row", "add-operation", "apply-json", "reset-json", "correct", "save", "restore"]) el(name).disabled = true;
    refreshProjects(); message("Selecciona un proyecto."); return;
  }
  withBusy(() => load(id));
});
el("reload").addEventListener("click", () => {
  if (!projectId) return;
  if ((dirty || jsonDirty) && !window.confirm("Hay cambios sin guardar. ¿Descartarlos y volver a cargar?")) return;
  withBusy(() => load(projectId));
});
window.addEventListener("crochelab-projects-changed", refreshProjects);
window.addEventListener("beforeunload", event => {
  if (dirty || jsonDirty) { event.preventDefault(); event.returnValue = ""; }
});

el("photos").addEventListener("click", event => perform(() => {
  const button = event.target.closest("[data-photo]");
  if (!button) return;
  selectedPhoto = button.dataset.photo;
  region = null;
  renderPhoto();
}));
el("photos").addEventListener("change", event => perform(() => {
  requireCurrent();
  const reviewedId = event.target.dataset.photoReviewed;
  if (reviewedId) {
    if (!project().photos.some(photo => photo.id === reviewedId)) throw new Error("No se encontró la fotografía.");
    draft.photoReviews[reviewedId] = event.target.checked;
    draft.completionConfirmed = false;
    dirty = true; renderOutputs(); return;
  }
  const id = event.target.dataset.photoRole;
  if (!id || !project().photos.some(photo => photo.id === id)) throw new Error("No se encontró la fotografía.");
  draft.photoRoles[id] = event.target.value;
  draft.completionConfirmed = false;
  dirty = true; renderOutputs();
}));
el("add-photos").addEventListener("click", () => perform(() => {
  requireCurrent();
  if (dirty) throw new Error("Guarda la revisión antes de editar las fotografías del proyecto.");
  bridge.editProject(projectId);
  message("Tras guardar el proyecto, vuelve a cargarlo para incorporar las fotografías.");
}));
el("analyze").addEventListener("click", () => withBusy(async () => {
  requireCurrent();
  const photos = project().photos.map(photo => ({ id: photo.id, photo, role: draft.photoRoles[photo.id] || "other" }));
  const result = await analyzePhotos(photos, async item => {
    const blob = await bridge.photoBlob(item.photo);
    return ai.analyzeReconstructionPhoto({ id: item.id, role: item.role, blob });
  }, () => newId("f"), (index, total) => { el("analysis-status").textContent = `Analizando fotografía ${index} de ${total}…`; });
  draft.findings.push(...result.findings.map(finding => ({ ...finding, origin: "ai" })));
  draft.analysisRuns.push({ id: newId("a"), results: result.results });
  draft.completionConfirmed = false;
  dirty = true;
  const failures = result.results.filter(item => item.status === "failed");
  el("analysis-status").textContent = failures.length
    ? `Análisis incompleto. Fallaron: ${failures.map(item => `${item.photoId}: ${item.error}`).join("; ")}`
    : `Se analizaron ${result.results.length} fotografías. Revisa los hallazgos antes de usarlos.`;
  message(result.complete ? "Análisis recibido; las decisiones siguen pendientes de revisión." : "Análisis parcial; revisa los errores indicados.", !result.complete);
}));
el("add-finding").addEventListener("click", () => perform(() => {
  requireCurrent({ allowManual: true });
  const statement = el("manual-finding").value.trim();
  if (!statement || !selectedPhoto) throw new Error("Selecciona una fotografía y escribe la observación.");
  const kind = el("manual-kind").value;
  draft.findings.push({
    id: newId("f"), kind, category: "other", statement, confidence: "unknown",
    photoId: selectedPhoto, region: null, review: kind === "unknown" ? "pending" : "confirmed", corrections: [], origin: "human"
  });
  draft.completionConfirmed = false;
  el("manual-finding").value = "";
  dirty = true; render(); message("Observación humana añadida.");
}));
el("findings").addEventListener("click", event => perform(() => {
  const show = event.target.closest("[data-show-finding]");
  if (show) {
    const finding = findFinding(show.dataset.showFinding);
    if (!finding || !project().photos.some(photo => photo.id === finding.photoId)) throw new Error("La fotografía de este hallazgo ya no está disponible.");
    selectedPhoto = finding.photoId; region = finding.region; renderPhoto(); return;
  }
  const button = event.target.closest("[data-review-finding]");
  if (!button) return;
  requireCurrent({ allowFindings: true });
  const card = button.closest("[data-finding]");
  const values = ["x", "y", "width", "height"].map(name => card.querySelector(`[data-finding-${name}]`).value);
  if (values.some(Boolean) && values.some(value => !value)) throw new Error("Completa las cuatro coordenadas de la zona o deja todas vacías.");
  const reviewedRegion = values.some(Boolean) ? Object.fromEntries(["x", "y", "width", "height"].map((name, index) => [name, Number(values[index])])) : null;
  draft = reviewFinding(draft, button.dataset.reviewFinding, card.querySelector("[data-finding-review]").value,
    card.querySelector("[data-finding-statement]").value, card.querySelector("[data-finding-reason]").value,
    card.querySelector("[data-finding-kind]").value, reviewedRegion);
  pendingFindings.delete(button.dataset.reviewFinding);
  draft.completionConfirmed = false;
  dirty = true; render(); message("Revisión aplicada; comprueba las evidencias de las operaciones afectadas.");
}));
el("findings").addEventListener("input", event => {
  const card = event.target.closest("[data-finding]");
  if (!card || !draft) return;
  pendingFindings.set(card.dataset.finding, Object.fromEntries(
    ["statement", "kind", "review", "reason", "x", "y", "width", "height"].map(name => [name, card.querySelector(`[data-finding-${name}]`).value])));
  dirty = true;
});
el("findings").addEventListener("change", event => {
  const card = event.target.closest("[data-finding]");
  if (!card || !draft) return;
  pendingFindings.set(card.dataset.finding, Object.fromEntries(
    ["statement", "kind", "review", "reason", "x", "y", "width", "height"].map(name => [name, card.querySelector(`[data-finding-${name}]`).value])));
  dirty = true;
});
el("manual-finding").addEventListener("input", () => { if (draft) dirty = true; });
el("base").addEventListener("click", () => perform(() => {
  requireCurrent();
  if (draft.logicalDocument) throw new Error("Ya existe una construcción. No se reemplazará automáticamente.");
  const count = numberFrom("base-count", 1);
  const finding = findFinding(el("evidence").value);
  if (!finding || finding.review !== "confirmed" || finding.kind === "unknown") throw new Error("Selecciona un hallazgo confirmado para el inicio.");
  draft.logicalDocument = {
    schemaVersion: "1.0.0", id: "logic", revision: { id: newId("r"), parentId: null, change: null },
    conventions: { rowCountStitchTypes: ["sc", "hdc", "dc", "tr", "sc2tog"], rowCountChainRoles: [] },
    initial: {
      direction: "right_to_left", anchors: [{ id: "start", kind: "edge" }], frontier: [],
      activeLoop: { id: "loop", origin: { kind: "attached_to", anchor: "initial/start" } }
    },
    motifs: [],
    rows: [{
      id: "row1", direction: "right_to_left",
      operations: [{ id: "base", type: "chain", chainIds: { tokens: Array.from({ length: count }, (_, i) => `c${i + 1}`) }, role: "foundation" }],
      nextPass: { export: ["chain.anchor"], carry: [], skip: [], order: "reverse" }
    }]
  };
  evidenceFor("row1/base", draft.logicalDocument.rows[0].operations[0]);
  draft.completionConfirmed = false;
  dirty = true; render(); message("Inicio creado a partir de la cantidad indicada por la persona.");
}));
el("row").addEventListener("click", () => perform(() => {
  requireCurrent();
  const doc = draft.logicalDocument;
  if (!doc || !Array.isArray(doc.rows) || !doc.rows.length) throw new Error("Define primero el inicio.");
  const trace = execute(doc);
  if (trace.status !== "valid") throw new Error("Resuelve la fila anterior antes de añadir otra.");
  checkpoint();
  const last = doc.rows[doc.rows.length - 1];
  const row = {
    id: unusedId(doc.rows, "row"), direction: last.direction === "right_to_left" ? "left_to_right" : "right_to_left",
    operations: [{ id: "turn", type: "turn" }],
    nextPass: { export: ["sc.top", "hdc.top", "dc.top", "tr.top", "sc2tog.top"], carry: [], skip: [], order: "reverse" }
  };
  doc.rows.push(row);
  advanceRevision(doc);
  draft.completionConfirmed = false;
  dirty = true; render(); el("row-select").value = row.id; renderOperations();
  message("Fila añadida. Por defecto exporta los puntos tejidos, no cadenetas ni deslizados; revisa la política en el documento.");
}));
el("row-select").addEventListener("change", () => perform(renderOperations));
el("add-operation").addEventListener("click", () => perform(() => {
  requireCurrent();
  const row = rowAndOperation();
  const finding = findFinding(el("evidence").value);
  if (!finding || finding.review !== "confirmed" || finding.kind === "unknown") throw new Error("Selecciona un hallazgo confirmado para la operación.");
  const type = el("operation-type").value;
  const id = unusedId(row.operations, "op");
  const target = el("target").value.trim();
  let operation;
  if (type === "chain") {
    const count = numberFrom("count", 1);
    const role = el("chain-role").value;
    if (!role) throw new Error("Indica la función de las cadenetas.");
    operation = { id, type, chainIds: { tokens: Array.from({ length: count }, (_, i) => `c${i + 1}`) }, role };
  } else {
    if (!target) throw new Error("Indica el anclaje de entrada.");
    if (type === "increase") {
      const count = numberFrom("count", 2);
      operation = { id, type, target: { ref: target }, stitchType: "sc", stitchIds: { tokens: Array.from({ length: count }, (_, i) => `p${i + 1}`) } };
    } else if (type === "decrease") {
      const second = el("target2").value.trim();
      if (!second) throw new Error("Indica el segundo anclaje.");
      operation = { id, type, technique: "sc2tog", targets: [{ ref: target }, { ref: second }] };
    } else if (type === "slip") operation = { id, type, target: { ref: target }, reuse: "none" };
    else operation = { id, type, target: { ref: target } };
  }
  checkpoint();
  row.operations.push(operation);
  advanceRevision(draft.logicalDocument);
  evidenceFor(`${row.id}/${id}`, operation);
  draft.completionConfirmed = false;
  dirty = true; render(); message("Operación añadida; revisa los diagnósticos y el recuento.");
}));
el("operations").addEventListener("click", event => perform(() => {
  requireCurrent();
  const row = rowAndOperation();
  const link = event.target.closest("[data-link-operation]");
  const remove = event.target.closest("[data-remove-operation]");
  const move = event.target.closest("[data-move-operation]");
  const id = link ? link.dataset.linkOperation : remove ? remove.dataset.removeOperation : move && move.dataset.moveOperation;
  if (!id) return;
  const index = row.operations.findIndex(operation => operation.id === id);
  if (index < 0) throw new Error("No se encontró la operación.");
  if (link) {
    evidenceFor(`${row.id}/${id}`, row.operations[index]);
    draft.completionConfirmed = false;
    dirty = true; render(); message("Evidencia vinculada a esta versión de la operación."); return;
  }
  if (remove && !window.confirm(`¿Quitar la operación ${id}? Las referencias dependientes no se cambiarán.`)) return;
  checkpoint();
  if (remove) row.operations.splice(index, 1);
  else {
    const target = index + Number(move.dataset.direction);
    if (target < 0 || target >= row.operations.length) throw new Error("No se puede mover fuera de la fila.");
    [row.operations[index], row.operations[target]] = [row.operations[target], row.operations[index]];
  }
  advanceRevision(draft.logicalDocument);
  draft.completionConfirmed = false;
  dirty = true; render(); message("Construcción modificada; revisa las referencias.");
}));
el("correct").addEventListener("click", () => perform(() => {
  requireCurrent();
  const row = rowAndOperation();
  const operationId = el("correction-operation").value.trim();
  const parameter = el("correction-parameter").value.trim();
  const iterationId = el("correction-iteration").value.trim();
  const motifId = el("correction-motif").value.trim();
  const operation = row.operations.find(item => item.id === operationId);
  if (!operation || !parameter) throw new Error("Indica una operación y un parámetro existentes.");
  let target;
  let before;
  if (iterationId || motifId) {
    if (!iterationId || !motifId || operation.type !== "repeat") throw new Error("Indica una repetición, iteración e instancia de motivo.");
    const iteration = operation.iterations.find(item => item.id === iterationId);
    const motif = operation.operations.find(item => item.id === motifId && item.type === "motif");
    if (!iteration || !motif) throw new Error("No se encontró la instancia.");
    const override = Object.hasOwn(iteration.overrides, motifId) ? iteration.overrides[motifId] : {};
    before = Object.hasOwn(override, parameter) ? override[parameter] : motif.bindings[parameter];
    if (before && before.param) before = iteration.bindings[before.param];
    target = { rowId: row.id, repeatId: operationId, iterationId, motifId, parameter };
  } else {
    before = operation[parameter];
    target = { rowId: row.id, operationId, parameter };
  }
  if (before === undefined) throw new Error("No se encontró el parámetro anterior.");
  const after = JSON.parse(el("correction-value").value);
  const correction = { revisionId: newId("r"), target, before, after, reason: el("correction-reason").value.trim() };
  const result = correctLogicalDocument(draft, correction);
  checkpoint();
  draft = result.reconstruction;
  draft.completionConfirmed = false;
  dirty = true; render();
  message(result.result.brokenReferences.length
    ? `Corrección aplicada. Referencias rotas: ${result.result.brokenReferences.join(", ")}`
    : "Corrección aplicada; vuelve a vincular la evidencia de la operación modificada.", Boolean(result.result.brokenReferences.length));
}));
el("json").addEventListener("input", () => { jsonDirty = true; });
el("reset-json").addEventListener("click", () => perform(() => {
  if (jsonDirty && !window.confirm("¿Descartar la edición JSON no aplicada?")) return;
  jsonDirty = false; render(); message("Edición JSON descartada.");
}));
el("apply-json").addEventListener("click", () => perform(() => {
  if (!current()) throw new Error("El proyecto o el espacio cambió.");
  if (pendingFindings.size || el("manual-finding").value.trim()) throw new Error("Aplica primero las revisiones y observaciones pendientes.");
  const parsed = JSON.parse(el("json").value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("El documento debe ser un objeto JSON.");
  const previous = draft.logicalDocument;
  parsed.revision = { id: newId("r"), parentId: previous && previous.revision ? previous.revision.id : null, change: null };
  const structural = execute(parsed).diagnostics.filter(item => item.code === "STRUCTURE" || item.code === "UNSUPPORTED_VERSION");
  if (structural.length) throw new Error(`Documento incompatible: ${structural.map(item => item.message).join("; ")}`);
  checkpoint();
  draft.logicalDocument = parsed;
  draft.completionConfirmed = false;
  jsonDirty = false; dirty = true; render();
  message("Documento aplicado como revisión humana; vuelve a vincular las operaciones modificadas.");
}));
for (const name of ["materials", "notes"]) el(name).addEventListener("input", () => {
  if (draft && current()) { draft[name] = el(name).value; dirty = true; renderOutputs(); }
});
el("complete").addEventListener("change", () => perform(() => {
  requireCurrent();
  draft.completionConfirmed = el("complete").checked;
  dirty = true; renderOutputs();
}));
el("save").addEventListener("click", () => withBusy(async () => {
  requireCurrent();
  const version = captureVersion();
  const record = structuredClone(draft);
  record.revisions.push(version);
  record.outputs = version.outputs;
  const size = new TextEncoder().encode(JSON.stringify(record)).length;
  if (size > 700000) throw new Error("La reconstrucción supera el límite seguro de tamaño; no se ha guardado ni borrado ninguna versión.");
  await bridge.save(record, saved, projectSnapshot, context);
  if (!bridge.isCurrent(context)) throw new Error("El guardado pudo completarse en el espacio anterior; compruébalo antes de continuar.");
  saved = record; draft = structuredClone(record); dirty = false;
  message("Revisión guardada. La validación no certifica fidelidad a la prenda.");
}));
el("restore").addEventListener("click", () => perform(() => {
  requireCurrent();
  const version = draft.revisions.find(item => item.id === el("versions").value);
  if (!version) throw new Error("No se encontró la versión.");
  if (!window.confirm("¿Recuperar esta versión como borrador? Las versiones guardadas se conservarán.")) return;
  checkpoint();
  const parentRevision = draft.logicalDocument && draft.logicalDocument.revision.id;
  for (const key of ["photoRoles", "photoReviews", "completionConfirmed", "analysisRuns", "findings", "materials", "notes", "logicalDocument", "operationEvidence"]) {
    draft[key] = structuredClone(version[key]);
  }
  if (draft.logicalDocument) draft.logicalDocument.revision = { id: newId("r"), parentId: parentRevision || null, change: null };
  draft.completionConfirmed = false;
  dirty = true; render(); message("Versión recuperada como borrador; guarda para crear una revisión nueva.");
}));

if (!bridge || !catalog || !ai) {
  message("No se pudieron cargar los componentes de reconstrucción.", true);
} else {
  refreshProjects();
}
