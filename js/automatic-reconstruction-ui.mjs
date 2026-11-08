import { generateAutomaticReconstruction } from "./automatic-reconstruction.mjs";

const bridge = window.CrocheLabReconstructionBridge;
const ai = window.CrocheLabAI;
const catalog = window.CrocheLabSymbols;
const el = name => document.getElementById(`automatic-${name}`);
let projectId = "";
let context = null;
let projectSnapshot = null;
let saved = null;
let draft = null;
let unsaved = false;
let busy = false;
let requestId = 0;
let photoUrls = [];
let creating = null;

function message(text, error = false) {
  el("status").textContent = text;
  el("status").classList.toggle("error", error);
}

function project() {
  return bridge.projects().find(item => item.id === projectId);
}

function current() {
  return context && bridge.isCurrent(context) && project();
}

function updateControls() {
  el("project").disabled = busy;
  el("new").disabled = busy;
  el("photos-button").disabled = busy || !current() || unsaved;
  el("generate").disabled = busy || !current() || unsaved || !project().photos.length || !ai.isConfigured();
  el("save").hidden = !unsaved;
  el("save").disabled = busy || !current();
}

function releasePhotos() {
  photoUrls.forEach(url => URL.revokeObjectURL(url));
  photoUrls = [];
}

function renderPhotos() {
  releasePhotos();
  el("photos").replaceChildren();
  const selected = project();
  if (!selected || !selected.photos.length) {
    el("photos").textContent = "Añade una fotografía general y, si puedes, imágenes de los detalles.";
    return;
  }
  selected.photos.forEach((photo, index) => {
    const url = photo.blob instanceof Blob ? URL.createObjectURL(photo.blob) : photo.downloadUrl;
    if (photo.blob instanceof Blob) photoUrls.push(url);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "automatic-photo";
    const caption = photo.label || photo.name || (index === 0 ? "Fotografía general" : `Detalle ${index}`);
    button.setAttribute("aria-label", `Ampliar ${caption}`);
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = caption;
      button.appendChild(image);
      button.addEventListener("click", () => {
        el("photo-large").src = url;
        el("photo-large").alt = caption;
        el("photo-dialog").showModal();
      });
    } else button.textContent = `${caption}: imagen no disponible`;
    const label = document.createElement("span");
    label.textContent = index === 0 ? "General" : `Detalle ${index}`;
    button.appendChild(label);
    el("photos").appendChild(button);
  });
}

function addList(container, title, entries) {
  if (!entries.length) return;
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  entries.forEach(text => {
    const item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  });
  container.append(heading, list);
}

function renderResult() {
  const automatic = draft && draft.automatic;
  el("result").hidden = !automatic;
  if (!automatic) return;
  const { outputs, proposal, findings, photoResults } = automatic;
  const analyzed = new Set(photoResults.map(item => item.photoId));
  const missingPhotos = project() ? project().photos.filter(photo => !analyzed.has(photo.id)) : [];
  const status = outputs.status === "valid" ? "La construcción ha superado las comprobaciones lógicas." :
    outputs.status === "invalid" ? "La construcción contiene errores y no es un patrón listo para tejer." :
      "La propuesta está incompleta o contiene aspectos no suficientemente seguros.";
  el("validation").textContent = `${status} Es una propuesta automática sin revisión humana; no se garantiza su fidelidad ni viabilidad.${missingPhotos.length ? " Hay fotografías nuevas que no se han analizado; genera de nuevo para incluirlas." : ""}`;
  el("instructions").textContent = outputs.instructions;
  el("svg").innerHTML = outputs.svg || "<p>No hay un esquema ejecutable disponible.</p>";
  const reliability = el("reliability");
  reliability.replaceChildren();
  const photoName = id => {
    const photo = project() && project().photos.find(item => item.id === id);
    return photo ? (photo.label || photo.name || "Fotografía") : "Fotografía no disponible";
  };
  const confidence = value => ({ high: "alta", medium: "media", low: "baja", unknown: "sin determinar" })[value] || value;
  addList(reliability, "Observaciones", findings.filter(item => item.kind === "observation")
    .map(item => `${item.statement} (${photoName(item.photoId)}; confianza ${confidence(item.confidence)})`));
  addList(reliability, "Interpretaciones", findings.filter(item => item.kind === "inference")
    .map(item => `${item.statement} (${photoName(item.photoId)}; confianza ${confidence(item.confidence)})`));
  addList(reliability, "Suposiciones", proposal.assumptions);
  addList(reliability, "No determinado", [...proposal.unknowns,
    ...findings.filter(item => item.kind === "unknown").map(item => `${item.statement} (${photoName(item.photoId)})`)]);
  addList(reliability, "Avisos", [...photoResults.filter(item => item.status === "failed")
    .map(item => `${photoName(item.photoId)}: ${item.error}`), ...outputs.diagnostics,
    ...missingPhotos.map(item => `${photoName(item.id)} todavía no se ha analizado.`)]);
}

function refreshProjects() {
  const projects = bridge.projects();
  const select = el("project");
  select.replaceChildren(new Option("Selecciona un proyecto…", ""));
  projects.forEach(item => select.add(new Option(item.name, item.id)));
  if (projectId && !projects.some(item => item.id === projectId)) select.add(new Option("Proyecto anterior no disponible", projectId));
  select.value = projectId;
  if (creating) {
    const added = projects.find(item => !creating.has(item.id));
    if (added && !busy) {
      creating = null;
      void load(added.id);
      return;
    }
  }
  if (projectId && !current()) message("El proyecto o el espacio cambió. Vuelve a seleccionar el proyecto.", true);
  updateControls();
}

async function load(id) {
  if (busy) return;
  if (unsaved && !window.confirm("La propuesta no se ha guardado. ¿Descartarla y cambiar de proyecto?")) {
    el("project").value = projectId;
    return;
  }
  const sequence = ++requestId;
  if (!id) {
    projectId = ""; context = null; saved = null; draft = null; unsaved = false;
    renderPhotos(); renderResult(); updateControls(); message("Selecciona un proyecto."); return;
  }
  const nextContext = bridge.context();
  const expected = bridge.projectSnapshot(id);
  if (expected === undefined) { message("No se pudo verificar el proyecto.", true); return; }
  busy = true; updateControls();
  try {
    const record = await bridge.get(id, nextContext);
    if (sequence !== requestId || !bridge.isCurrent(nextContext)) throw new Error("El espacio cambió durante la carga.");
    if (!bridge.projects().some(item => item.id === id)) throw new Error("El proyecto ya no está disponible.");
    if (record && (record.id !== `reconstruction-${id}` || record.projectId !== id)) throw new Error("La reconstrucción guardada no corresponde al proyecto.");
    projectId = id; context = nextContext; projectSnapshot = expected; saved = record; draft = record; unsaved = false;
    refreshProjects(); renderPhotos(); renderResult();
    message(record && record.automatic ? "Propuesta recuperada." :
      !project().photos.length ? "Añade fotografías para generar una propuesta." :
        !ai.isConfigured() ? "El análisis visual no está disponible en este momento." :
          "Proyecto preparado. Pulsa GENERAR PATRÓN.");
  } catch (error) {
    message(`No se pudo abrir el proyecto: ${error.message}`, true);
    el("project").value = projectId;
  } finally { busy = false; updateControls(); }
}

async function save() {
  if (!current()) throw new Error("El proyecto o el espacio cambió; la propuesta no se ha guardado.");
  const size = new TextEncoder().encode(JSON.stringify(draft)).length;
  if (size > 700000) throw new Error("La propuesta y su historial superan el límite seguro de almacenamiento; no se ha eliminado ninguna versión.");
  await bridge.save(draft, saved, projectSnapshot, context);
  if (!bridge.isCurrent(context)) throw new Error("El guardado pudo completarse en el espacio anterior; compruébalo antes de continuar.");
  saved = structuredClone(draft);
  unsaved = false;
  message("Propuesta guardada. Comprueba los avisos antes de tejer.");
}

el("project").addEventListener("change", () => { void load(el("project").value); });
el("new").addEventListener("click", () => {
  if (unsaved) { message("Guarda primero la propuesta pendiente.", true); return; }
  creating = new Set(bridge.projects().map(item => item.id));
  bridge.createProject();
});
el("photos-button").addEventListener("click", () => {
  if (!current()) { message("Vuelve a seleccionar el proyecto.", true); return; }
  bridge.editProject(projectId);
  message("Guarda el proyecto después de añadir las fotografías.");
});
el("generate").addEventListener("click", async () => {
  if (busy || !current() || unsaved) return;
  busy = true; updateControls();
  try {
    const selected = project();
    const generated = await generateAutomaticReconstruction(selected, saved, {
      analyzePhoto: async item => ai.analyzeReconstructionPhoto({ id: item.id, role: item.role, blob: await bridge.photoBlob(item.photo) }),
      propose: ai.proposeReconstruction,
      makeFindingId: () => `f${crypto.randomUUID()}`,
      now: () => new Date().toISOString(),
      catalog,
      onProgress: (index, total) => message(`Analizando fotografía ${index} de ${total}…`),
      onPhase: message
    });
    draft = generated; unsaved = true; renderResult();
    message("Propuesta preparada. Guardando…");
    await save();
  } catch (error) {
    console.error("Generación de patrón:", error);
    message(`${error.message}${unsaved ? " La propuesta permanece en pantalla sin guardar." : ""}`, true);
  } finally { busy = false; updateControls(); }
});
el("save").addEventListener("click", async () => {
  if (busy || !unsaved) return;
  busy = true; updateControls();
  try {
    await bridge.refresh();
    if (!bridge.isCurrent(context)) throw new Error("El espacio cambió; la propuesta sigue sin guardarse.");
    const updatedProject = bridge.projectSnapshot(projectId);
    if (!updatedProject || !await bridge.sameData(updatedProject.photos, projectSnapshot.photos)) {
      throw new Error("Las fotografías del proyecto cambiaron. La propuesta sigue en pantalla y no se sobrescribirá el proyecto.");
    }
    projectSnapshot = updatedProject;
    await save();
  }
  catch (error) { console.error("Guardado de patrón:", error); message(error.message, true); }
  finally { busy = false; updateControls(); }
});
window.addEventListener("crochelab-projects-changed", () => {
  const wasCurrent = current();
  refreshProjects();
  if (wasCurrent && projectId && !busy && !unsaved) void load(projectId);
});
window.addEventListener("beforeunload", event => {
  if (unsaved || busy) { event.preventDefault(); event.returnValue = ""; }
});

if (bridge && ai && catalog) refreshProjects();
else message("No se pudieron cargar los componentes de generación.", true);
