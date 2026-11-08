import { execute } from "./crochet-core/index.mjs";
import { analyzePhotos, automaticTraceOutputs, createReconstruction } from "./reconstruction.mjs";

function checkedProposal(value, findings) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Object.hasOwn(value, "document") || (value.document !== null &&
      (typeof value.document !== "object" || Array.isArray(value.document))) ||
      !Array.isArray(value.claims) || !Array.isArray(value.assumptions) || !Array.isArray(value.unknowns) ||
      typeof value.complete !== "boolean" ||
      !value.assumptions.every(item => typeof item === "string" && item.trim()) ||
      !value.unknowns.every(item => typeof item === "string" && item.trim())) {
    throw new Error("La propuesta recibida no tiene el formato esperado.");
  }
  const known = new Map(findings.map(finding => [finding.id, finding]));
  const claims = new Map();
  for (const claim of value.claims) {
    if (!claim || typeof claim.path !== "string" || !claim.path ||
        !["high", "medium", "low"].includes(claim.confidence) ||
        !Array.isArray(claim.findingIds) || !claim.findingIds.length ||
        claim.findingIds.some(id => !known.has(id) || known.get(id).kind === "unknown") ||
        claims.has(claim.path)) throw new Error("La propuesta contiene evidencias incompatibles o inexistentes.");
    claims.set(claim.path, claim);
  }
  return { ...value, claimMap: claims };
}

function renderProposal(proposal, findings, photoResults, catalog) {
  const diagnostics = [];
  if (photoResults.some(result => result.status === "failed")) diagnostics.push("No se pudieron analizar todas las fotografías.");
  if (findings.some(item => item.kind === "unknown")) diagnostics.push("Hay aspectos de las fotografías que no se han podido identificar.");
  if (proposal.assumptions.length) diagnostics.push("La propuesta contiene inferencias o suposiciones.");
  if (proposal.unknowns.length) diagnostics.push("Quedan elementos sin determinar.");
  if (!proposal.complete) diagnostics.push("No se ha podido reconstruir toda la pieza.");
  if (!proposal.document) {
    return { status: "incomplete", logicalStatus: "incomplete", trace: null, instructions: "No se pudo determinar una secuencia de tejido.", svg: null, diagnostics };
  }
  const trace = execute(proposal.document);
  for (const row of Array.isArray(proposal.document.rows) ? proposal.document.rows : []) {
    for (const operation of row && Array.isArray(row.operations) ? row.operations : []) {
      if (!operation || typeof operation !== "object" || ["turn", "space", "unknown"].includes(operation.type)) continue;
      const path = `${row.id}/${operation.id}`;
      const claim = proposal.claimMap.get(path);
      if (!claim) diagnostics.push(`Hay una operación sin evidencia asociada (${path}).`);
      else if (claim.confidence !== "high" || claim.findingIds.some(id => findings.find(item => item.id === id).kind === "inference")) {
        diagnostics.push(`Una operación es una interpretación no segura (${path}).`);
      }
    }
  }
  let status = trace.status === "invalid" ? "invalid" : trace.status === "incomplete" || diagnostics.length ? "incomplete" : "valid";
  let rendered = { instructions: "No se pudo generar una secuencia ejecutable.", svg: null };
  try {
    rendered = automaticTraceOutputs(trace, catalog);
  } catch (error) {
    diagnostics.push(`No se puede representar el resultado: ${error.message}`);
    if (status === "valid") status = "incomplete";
  }
  return { status, logicalStatus: trace.status, trace, ...rendered, diagnostics: [...diagnostics, ...trace.diagnostics.map(item => item.message)] };
}

export async function generateAutomaticReconstruction(project, previous, options) {
  if (!project || !Array.isArray(project.photos) || !project.photos.length) throw new Error("Añade al menos una fotografía al proyecto.");
  const reconstruction = previous ? structuredClone(previous) : createReconstruction(project);
  if (reconstruction.projectId !== project.id || reconstruction.id !== `reconstruction-${project.id}`) {
    throw new Error("La reconstrucción guardada pertenece a otro proyecto.");
  }
  const photos = project.photos.map((photo, index) => ({
    id: photo.id, photo, role: reconstruction.photoRoles[photo.id] || (index === 0 ? "overview" : "detail")
  }));
  const analysis = await analyzePhotos(photos, options.analyzePhoto, options.makeFindingId, options.onProgress);
  let proposal = { document: null, claims: [], assumptions: [], unknowns: [], complete: false, claimMap: new Map() };
  let synthesisError = null;
  if (analysis.findings.length) {
    try {
      if (options.onPhase) options.onPhase("Construyendo y validando la propuesta…");
      proposal = checkedProposal(await options.propose(analysis.findings, []), analysis.findings);
      if (proposal.document) {
        const first = execute(proposal.document);
        if (first.status === "invalid") {
          try {
            const retry = checkedProposal(await options.propose(analysis.findings, first.diagnostics.map(item => item.message)), analysis.findings);
            if (retry.document && execute(retry.document).status !== "invalid") proposal = retry;
          } catch (error) {
            synthesisError = `No se pudo mejorar la construcción: ${error.message}`;
          }
        }
      }
    } catch (error) {
      synthesisError = `No se pudo construir una propuesta: ${error.message}`;
    }
  } else synthesisError = "No se obtuvo ningún hallazgo de las fotografías.";
  const outputs = renderProposal(proposal, analysis.findings, analysis.results, options.catalog);
  if (synthesisError) outputs.diagnostics.push(synthesisError);
  const { claimMap, ...serializableProposal } = proposal;
  if (reconstruction.automatic) {
    if (!Array.isArray(reconstruction.automaticHistory)) reconstruction.automaticHistory = [];
    reconstruction.automaticHistory.push(reconstruction.automatic);
  }
  reconstruction.automatic = {
    createdAt: options.now(), findings: analysis.findings, photoResults: analysis.results,
    proposal: serializableProposal, outputs
  };
  return reconstruction;
}
