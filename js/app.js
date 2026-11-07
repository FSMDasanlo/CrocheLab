(function () {
  "use strict";

  const DATABASE_NAME = "crochelab";
  const DATABASE_VERSION = 2;
  const STORE_NAME = "projects";
  const PATTERN_STORE_NAME = "patterns";
  const symbolLibrary = window.CrocheLabSymbols;
  const diagramEngine = window.CrocheLabDiagram;
  const aiAnalysis = window.CrocheLabAI;
  const firebaseService = window.CrocheLabFirebase;
  let aiBusy = false;
  const elements = {
    authButton: document.getElementById("auth-button"),
    userAvatar: document.getElementById("user-avatar"),
    userDisplayName: document.getElementById("user-display-name"),
    userStatusText: document.getElementById("user-status-text"),
    storageStatusBadge: document.getElementById("storage-status-badge"),
    aiAnalyzeButton: document.getElementById("ai-analyze-button"),
    aiAnalysisStatus: document.getElementById("ai-analysis-status"),
    aiAnalysisResult: document.getElementById("ai-analysis-result"),
    count: document.getElementById("project-count"),
    photoCount: document.getElementById("photo-count"),
    subtitle: document.getElementById("project-subtitle"),
    projectList: document.getElementById("project-list"),
    emptyState: document.getElementById("empty-state"),
    noResults: document.getElementById("no-results"),
    search: document.getElementById("project-search"),
    projectDialog: document.getElementById("project-dialog"),
    projectForm: document.getElementById("project-form"),
    dialogTitle: document.getElementById("dialog-title"),
    name: document.getElementById("project-name"),
    garment: document.getElementById("project-garment"),
    description: document.getElementById("project-description"),
    photoInput: document.getElementById("photo-input"),
    photoStaging: document.getElementById("photo-staging"),
    saveButton: document.getElementById("save-project-button"),
    detailDialog: document.getElementById("detail-dialog"),
    projectDetail: document.getElementById("project-detail"),
    projectsPage: document.getElementById("projects-page"),
    catalogPage: document.getElementById("symbol-catalog"),
    diagramPage: document.getElementById("diagram-tool"),
    currentPageLabel: document.getElementById("current-page-label"),
    symbolFilters: document.getElementById("symbol-filters"),
    symbolSearch: document.getElementById("symbol-search"),
    symbolGrid: document.getElementById("symbol-grid"),
    symbolCount: document.getElementById("symbol-count"),
    symbolEmpty: document.getElementById("symbol-empty"),
    symbolDialog: document.getElementById("symbol-dialog"),
    symbolDetail: document.getElementById("symbol-detail"),
    diagramProjectSelect: document.getElementById("diagram-project-select"),
    diagramPhotoViewer: document.getElementById("diagram-photo-viewer"),
    diagramPhotoStrip: document.getElementById("diagram-photo-strip"),
    sketchStitchChoices: document.getElementById("sketch-stitch-choices"),
    sketchRows: document.getElementById("sketch-rows"),
    sketchRowsOutput: document.getElementById("sketch-rows-output"),
    diagramRenderButton: document.getElementById("diagram-render-button"),
    diagramSaveButton: document.getElementById("diagram-save-button"),
    diagramDownloadButton: document.getElementById("diagram-download-button"),
    diagramValidation: document.getElementById("diagram-validation"),
    diagramCanvas: document.getElementById("diagram-canvas"),
    diagramPreviewCaption: document.getElementById("diagram-preview-caption"),
    diagramRoundCount: document.getElementById("diagram-round-count"),
    toast: document.getElementById("toast")
  };

  let database;
  let projects = [];
  let stagedPhotos = [];
  let editingProjectId = null;
  let toastTimer;
  let activeObjectUrls = [];
  let detailObjectUrls = [];
  let selectedSymbolCategory = "all";
  let renderedPattern = null;
  let renderedSvg = "";
  let diagramPhotoUrls = [];
  let selectedDiagramPhotoId = null;

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(PATTERN_STORE_NAME)) {
          db.createObjectStore(PATTERN_STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = function () {
        database = request.result;
        database.onversionchange = function () {
          database.close();
        };
        resolve(database);
      };
      request.onerror = function () {
        reject(request.error || new Error("No se pudo abrir la base de datos local."));
      };
      request.onblocked = function () {
        reject(new Error("Cierra otras pestañas de CrochéLab y vuelve a intentarlo."));
      };
    });
  }

  function getAllProjects() {
    if (firebaseService && firebaseService.isCloudActive()) {
      return firebaseService.getAllProjects(firebaseService.getCurrentUser().uid);
    }
    return new Promise(function (resolve, reject) {
      if (!database) { resolve([]); return; }
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function saveProject(project) {
    if (firebaseService && firebaseService.isCloudActive()) {
      return firebaseService.saveProject(firebaseService.getCurrentUser().uid, project);
    }
    return new Promise(function (resolve, reject) {
      if (!database) { reject(new Error("Base de datos local no disponible.")); return; }
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(project);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error || new Error("No se pudo guardar el proyecto.")); };
    });
  }

  function deleteProject(projectId, projectPhotos) {
    if (firebaseService && firebaseService.isCloudActive()) {
      return firebaseService.deleteProject(firebaseService.getCurrentUser().uid, projectId, projectPhotos);
    }
    return new Promise(function (resolve, reject) {
      if (!database) { reject(new Error("Base de datos local no disponible.")); return; }
      const transaction = database.transaction([STORE_NAME, PATTERN_STORE_NAME], "readwrite");
      transaction.objectStore(STORE_NAME).delete(projectId);
      transaction.objectStore(PATTERN_STORE_NAME).delete("pattern-" + projectId);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error || new Error("No se pudo eliminar el proyecto.")); };
    });
  }

  function getPattern(patternId) {
    if (firebaseService && firebaseService.isCloudActive()) {
      return firebaseService.getPattern(firebaseService.getCurrentUser().uid, patternId);
    }
    return new Promise(function (resolve, reject) {
      if (!database) { resolve(null); return; }
      const request = database.transaction(PATTERN_STORE_NAME, "readonly").objectStore(PATTERN_STORE_NAME).get(patternId);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error || new Error("No se pudo leer el patrón.")); };
    });
  }

  function savePattern(pattern) {
    if (firebaseService && firebaseService.isCloudActive()) {
      return firebaseService.savePattern(firebaseService.getCurrentUser().uid, pattern);
    }
    return new Promise(function (resolve, reject) {
      if (!database) { reject(new Error("Base de datos local no disponible.")); return; }
      const transaction = database.transaction(PATTERN_STORE_NAME, "readwrite");
      transaction.objectStore(PATTERN_STORE_NAME).put(pattern);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error || new Error("No se pudo guardar el patrón.")); };
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  }

  function createObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    activeObjectUrls.push(url);
    return url;
  }

  function clearObjectUrls() {
    activeObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    activeObjectUrls = [];
  }

  function createDetailObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    detailObjectUrls.push(url);
    return url;
  }

  function clearDetailObjectUrls() {
    detailObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    detailObjectUrls = [];
  }

  function showToast(message, isError) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", Boolean(isError));
    elements.toast.classList.add("visible");
    toastTimer = window.setTimeout(function () {
      elements.toast.classList.remove("visible");
    }, 3500);
  }

  function clearDiagramPhotoUrls() {
    diagramPhotoUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    diagramPhotoUrls = [];
  }

  function getSelectedDiagramProject() {
    return projects.find(function (project) { return project.id === elements.diagramProjectSelect.value; }) || null;
  }

  function getSelectedStitchIds() {
    return Array.from(elements.sketchStitchChoices.querySelectorAll('input[name="sketch-stitch"]:checked'))
      .map(function (input) { return input.value; });
  }

  function setSelectedStitchIds(stitchIds) {
    const selected = new Set(stitchIds || []);
    elements.sketchStitchChoices.querySelectorAll('input[name="sketch-stitch"]').forEach(function (input) {
      input.checked = selected.has(input.value);
    });
    updateSketchControls();
  }

  function updateSketchControls() {
    elements.sketchRowsOutput.value = elements.sketchRows.value;
    elements.sketchRowsOutput.textContent = elements.sketchRows.value;
    elements.diagramRenderButton.disabled = !getSelectedDiagramProject() || getSelectedStitchIds().length === 0;
  }

  function renderStitchChoices() {
    const availableSymbols = symbolLibrary.all().filter(function (symbol) {
      return symbol.diagramSupported !== false && symbol.id !== "repeat";
    });
    elements.sketchStitchChoices.innerHTML = availableSymbols.map(function (symbol) {
      return '<label class="sketch-stitch-choice"><input type="checkbox" name="sketch-stitch" value="' + escapeHtml(symbol.id) + '">' +
        '<span class="sketch-stitch-choice-art">' + symbolLibrary.render(symbol.id, 38) + '</span>' +
        '<span class="sketch-stitch-choice-name">' + escapeHtml(symbol.name) + '</span></label>';
    }).join("");
    updateSketchControls();
  }

  function renderDiagramPhotoGallery(project, preferredPhotoId) {
    clearDiagramPhotoUrls();
    if (!project) {
      selectedDiagramPhotoId = null;
      elements.diagramPhotoViewer.innerHTML = '<div class="diagram-placeholder"><span aria-hidden="true">▧</span><p>Elige un proyecto para ver sus fotografías.</p></div>';
      elements.diagramPhotoStrip.innerHTML = "";
      return;
    }
    if (!project.photos.length) {
      selectedDiagramPhotoId = null;
      elements.diagramPhotoViewer.innerHTML = '<div class="diagram-placeholder"><span aria-hidden="true">▧</span><p>Este proyecto no tiene fotografías de referencia.</p></div>';
      elements.diagramPhotoStrip.innerHTML = "";
      return;
    }
    const selected = project.photos.find(function (photo) { return photo.id === preferredPhotoId; }) || project.photos[0];
    selectedDiagramPhotoId = selected.id;
    const urls = new Map();
    project.photos.forEach(function (photo) {
      let url = "";
      if (photo.downloadUrl) {
        url = photo.downloadUrl;
      } else if (photo.blob) {
        url = URL.createObjectURL(photo.blob);
        diagramPhotoUrls.push(url);
      }
      urls.set(photo.id, url);
    });
    elements.diagramPhotoViewer.innerHTML = '<img src="' + urls.get(selected.id) + '" alt="' + escapeHtml(selected.label || selected.name || "Foto principal del proyecto") + '">' +
      '<span class="reference-photo-caption">' + escapeHtml(selected.label || selected.name || "Foto de referencia") + '</span>';
    elements.diagramPhotoStrip.innerHTML = project.photos.map(function (photo, index) {
      const isSelected = photo.id === selected.id;
      return '<button class="diagram-photo-thumb' + (isSelected ? " active" : "") + '" type="button" data-photo-id="' + escapeHtml(photo.id) +
        '" aria-pressed="' + String(isSelected) + '" aria-label="' + escapeHtml(photo.label || photo.name || "Fotografía " + (index + 1)) + '">' +
        '<img src="' + urls.get(photo.id) + '" alt=""><span>' + (index === 0 ? "Principal" : "Detalle " + index) + '</span></button>';
    }).join("");
  }

  function renderDiagramProjectOptions() {
    const selectedProjectId = elements.diagramProjectSelect.value;
    const options = ['<option value="">Selecciona un proyecto…</option>'];
    projects.forEach(function (project) {
      options.push('<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name) + '</option>');
    });
    elements.diagramProjectSelect.innerHTML = options.join("");
    if (projects.some(function (project) { return project.id === selectedProjectId; })) {
      elements.diagramProjectSelect.value = selectedProjectId;
    } else {
      elements.diagramProjectSelect.value = "";
      renderDiagramPhotoGallery(null);
      resetDiagramPreview();
      updateSketchControls();
    }
    updateAiControls();
  }

  function resetDiagramPreview() {
    renderedPattern = null;
    renderedSvg = "";
    elements.diagramCanvas.classList.remove("has-crochet-chart");
    elements.diagramCanvas.innerHTML = '<div class="diagram-placeholder"><span aria-hidden="true">◇</span><p>Elige la forma y los puntos visibles para crear un boceto.</p></div>';
    elements.diagramPreviewCaption.textContent = "El boceto orientativo aparecerá aquí.";
    elements.diagramRoundCount.textContent = "";
    elements.diagramValidation.innerHTML = '<p class="diagram-idle-note">La foto permanece visible como referencia. Forma y puntos son una selección tuya o una propuesta de la IA que tú confirmas.</p>';
    elements.diagramSaveButton.disabled = true;
    elements.diagramDownloadButton.disabled = true;
  }

  function showDiagramMessages(errors, warnings, successText) {
    const messages = [];
    errors.forEach(function (message) {
      messages.push('<p class="validation-message error"><span aria-hidden="true">!</span><span>' + escapeHtml(message) + '</span></p>');
    });
    warnings.forEach(function (message) {
      messages.push('<p class="validation-message warning"><span aria-hidden="true">△</span><span>' + escapeHtml(message) + '</span></p>');
    });
    if (successText) {
      messages.unshift('<p class="validation-message success"><span aria-hidden="true">✓</span><span>' + escapeHtml(successText) + '</span></p>');
    }
    elements.diagramValidation.innerHTML = messages.join("");
  }

  function loadPatternForProject(projectId) {
    resetDiagramPreview();
    clearAiResult();
    updateAiControls();
    if (!projectId) {
      renderDiagramPhotoGallery(null);
      updateSketchControls();
      return Promise.resolve();
    }
    renderDiagramPhotoGallery(getSelectedDiagramProject());
    return getPattern("pattern-" + projectId).then(function (pattern) {
      if (elements.diagramProjectSelect.value !== projectId) return;
      const project = projects.find(function (item) { return item.id === projectId; });
      if (!project) return;
      const sketch = pattern && pattern.sketch;
      const projectPhotoIds = new Set(project.photos.map(function (photo) { return photo.id; }));
      const savedPhotoId = pattern && Array.isArray(pattern.sourceImages) && pattern.sourceImages.length
        ? pattern.sourceImages[0].photoId
        : project.photos[0] && project.photos[0].id;
      renderDiagramPhotoGallery(project, projectPhotoIds.has(savedPhotoId) ? savedPhotoId : null);
      document.querySelectorAll('input[name="sketch-shape"]').forEach(function (input) {
        input.checked = sketch ? input.value === sketch.shape : input.value === "triangle";
      });
      setSelectedStitchIds(sketch ? sketch.selectedStitchIds : []);
      elements.sketchRows.value = sketch ? sketch.detailRows : 6;
      updateSketchControls();
      if (sketch) {
        renderDiagramFromEditor();
      } else {
        elements.diagramPreviewCaption.textContent = pattern
          ? "Este proyecto conserva un diagrama anterior; selecciona opciones para generar un boceto visual."
          : "Elige la forma y los puntos visibles para crear un boceto de «" + project.name + "».";
      }
    }).catch(function (error) {
      console.error("No se pudo cargar el patrón del proyecto:", error);
      showDiagramMessages(["No se pudo cargar el patrón guardado."], [], "");
    });
  }

  const CONFIDENCE_LABELS = { high: "alta", medium: "media", low: "baja" };

  function updateAiControls() {
    const project = getSelectedDiagramProject();
    const configured = Boolean(aiAnalysis && aiAnalysis.isConfigured());
    elements.aiAnalyzeButton.disabled = !configured || !project || !project.photos.length || aiBusy;
    if (!configured) {
      elements.aiAnalysisStatus.textContent = "Análisis con IA no conectado: configura la clave de Gemini en js/config.js. Mientras tanto, elige forma y puntos a mano.";
    } else if (!project) {
      elements.aiAnalysisStatus.textContent = "Elige un proyecto con fotografías.";
    } else if (!aiBusy) {
      const used = Math.min(project.photos.length, aiAnalysis.maxPhotos);
      elements.aiAnalysisStatus.textContent = "Se enviarán " + used + (used === 1 ? " foto" : " fotos") + " a Gemini. El resultado es una propuesta que puedes corregir.";
    }
  }

  function clearAiResult() {
    elements.aiAnalysisResult.innerHTML = "";
  }

  function showAiProposal(proposal, catalog) {
    const names = new Map(catalog.map(function (stitch) { return [stitch.id, stitch.name]; }));
    const shapeNames = { triangle: "triangular", semicircle: "semicircular", rectangle: "rectangular", border: "puntilla / orilla" };
    const rows = [];
    rows.push("<p><strong>Prenda:</strong> " + escapeHtml(proposal.garment || "sin identificar") + "</p>");
    rows.push("<p><strong>Forma propuesta:</strong> " + (proposal.shape
      ? escapeHtml(shapeNames[proposal.shape]) + " (confianza " + CONFIDENCE_LABELS[proposal.shapeConfidence] + ")"
      : "ninguna de las formas disponibles; se mantiene tu selección") + "</p>");
    if (proposal.stitches.length) {
      rows.push("<ul>" + proposal.stitches.map(function (stitch) {
        return "<li><strong>" + escapeHtml(names.get(stitch.id)) + "</strong> · confianza " + CONFIDENCE_LABELS[stitch.confidence] +
          (stitch.evidence ? " — " + escapeHtml(stitch.evidence) : "") + "</li>";
      }).join("") + "</ul>");
    } else {
      rows.push("<p>La IA no identificó puntos con claridad.</p>");
    }
    if (proposal.uncertainties.length) {
      rows.push("<p><strong>Dudas:</strong> " + proposal.uncertainties.map(escapeHtml).join("; ") + "</p>");
    }
    rows.push('<p class="choice-hint">Propuesta, no resultado verificado. Se han marcado los puntos de confianza alta o media; revisa y corrige abajo.</p>');
    elements.aiAnalysisResult.innerHTML = rows.join("");
  }

  function analyzeSelectedProject() {
    const project = getSelectedDiagramProject();
    if (!project || aiBusy || !aiAnalysis) return;
    const catalog = symbolLibrary.all().filter(function (symbol) {
      return symbol.diagramSupported !== false && symbol.id !== "repeat";
    });
    aiBusy = true;
    clearAiResult();
    elements.aiAnalyzeButton.disabled = true;
    elements.aiAnalysisStatus.textContent = "Preparando fotografías…";

    const blobPromises = project.photos.map(function (photo) {
      if (photo.blob instanceof Blob) return Promise.resolve(photo.blob);
      if (firebaseService && photo.downloadUrl) {
        return firebaseService.ensurePhotoBlob(photo);
      }
      return Promise.reject(new Error("No se pudo obtener la imagen de una fotografía."));
    });

    Promise.all(blobPromises).then(function (blobs) {
      return aiAnalysis.analyzePhotos(blobs, catalog, function (phase, attempt) {
        if (getSelectedDiagramProject() === project) {
          if (phase === "requesting") {
            elements.aiAnalysisStatus.textContent = "Analizando fotografías con Gemini…";
          } else if (phase === "retrying") {
            elements.aiAnalysisStatus.textContent = "Gemini no estaba disponible; reintentando (" + attempt + " de 3)…";
          }
        }
      });
    }).then(function (proposal) {
      if (getSelectedDiagramProject() !== project) return;
      showAiProposal(proposal, catalog);
      if (proposal.shape) {
        document.querySelectorAll('input[name="sketch-shape"]').forEach(function (input) {
          input.checked = input.value === proposal.shape;
        });
      }
      setSelectedStitchIds(proposal.stitches
        .filter(function (stitch) { return stitch.confidence !== "low"; })
        .map(function (stitch) { return stitch.id; }));
      if (getSelectedStitchIds().length) renderDiagramFromEditor();
    }).catch(function (error) {
      console.error("Fallo el análisis con IA:", error);
      if (getSelectedDiagramProject() === project) {
        const message = error && error.message ? error.message : "No se pudieron analizar las fotos. Inténtalo de nuevo.";
        elements.aiAnalysisResult.innerHTML = '<p class="validation-message error"><span aria-hidden="true">!</span><span>' + escapeHtml(message) + '</span></p>';
      }
    }).finally(function () {
      aiBusy = false;
      updateAiControls();
    });
  }

  function renderDiagramFromEditor() {
    resetDiagramPreview();
    const project = getSelectedDiagramProject();
    if (!project) {
      showDiagramMessages(["Elige primero un proyecto."], [], "");
      return;
    }
    const selectedStitchIds = getSelectedStitchIds();
    if (!selectedStitchIds.length) {
      showDiagramMessages(["Marca al menos un tipo de punto para preparar el boceto."], [], "");
      return;
    }

    let pattern;
    try {
      pattern = diagramEngine.createSketch({
        projectId: project.id,
        photos: project.photos,
        shape: document.querySelector('input[name="sketch-shape"]:checked').value,
        rows: Number(elements.sketchRows.value),
        selectedStitchIds: selectedStitchIds
      });
      const validation = diagramEngine.validate(pattern);
      if (validation.errors.length) {
        showDiagramMessages(validation.errors, validation.warnings, "");
        return;
      }
      renderedSvg = diagramEngine.render(pattern);
      renderedPattern = pattern;
      elements.diagramCanvas.classList.add("has-crochet-chart");
      elements.diagramCanvas.innerHTML = renderedSvg;
      elements.diagramPreviewCaption.textContent = pattern.sketch && pattern.sketch.shape === "border"
        ? "Esquema de puntilla / orilla con abanicos y picots, compuesto con los puntos seleccionados."
        : (pattern.sketch && pattern.sketch.shape === "triangle"
          ? "Diagrama triangular de muestra, compuesto con los puntos que seleccionaste. No reproduce automáticamente la foto."
          : "Diagrama de muestra, compuesto con los puntos que seleccionaste. No reproduce automáticamente la foto.");
      elements.diagramRoundCount.textContent = validation.roundCount + (validation.roundCount === 1 ? " fila visual" : " filas visuales");
      elements.diagramSaveButton.disabled = false;
      elements.diagramDownloadButton.disabled = false;
      showDiagramMessages([], validation.warnings, validation.pointCount + " glifos distribuidos. No representan un recuento de puntos real.");
    } catch (error) {
      console.error("No se pudo generar el boceto:", error);
      showDiagramMessages(["No se pudo generar el boceto: " + error.message], [], "");
    }
  }

  function saveRenderedPattern() {
    if (!renderedPattern) {
      showDiagramMessages(["Genera primero un boceto para poder guardarlo."], [], "");
      return;
    }
    const validation = diagramEngine.validate(renderedPattern);
    if (validation.errors.length) {
      showDiagramMessages(validation.errors, validation.warnings, "");
      return;
    }
    elements.diagramSaveButton.disabled = true;
    savePattern(renderedPattern).then(function () {
      showToast("Boceto guardado en el proyecto.");
      showDiagramMessages([], validation.warnings, "Boceto guardado; no es un patrón de tejido.");
    }).catch(function (error) {
      console.error("No se pudo guardar el diagrama:", error);
      showDiagramMessages(["No se pudo guardar el diagrama en este dispositivo."], [], "");
    }).finally(function () {
      elements.diagramSaveButton.disabled = false;
    });
  }

  function downloadRenderedSvg() {
    if (!renderedSvg) return;
    const project = projects.find(function (item) { return item.id === elements.diagramProjectSelect.value; });
    const safeName = (project ? project.name : "diagrama").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const url = URL.createObjectURL(new Blob([renderedSvg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = (safeName || "crochelab") + "-diagrama.svg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function renderProjects() {
    clearObjectUrls();
    const query = elements.search.value.trim().toLocaleLowerCase("es");
    const filteredProjects = projects.filter(function (project) {
      return (project.name + " " + project.garment + " " + project.description).toLocaleLowerCase("es").includes(query);
    });
    const photoCount = projects.reduce(function (total, project) { return total + project.photos.length; }, 0);

    elements.count.textContent = String(projects.length);
    elements.photoCount.textContent = String(photoCount);
    elements.subtitle.textContent = projects.length
      ? projects.length + (projects.length === 1 ? " proyecto guardado" : " proyectos guardados")
      : "Tus proyectos aparecerán aquí.";
    elements.emptyState.hidden = projects.length > 0;
    elements.projectList.hidden = filteredProjects.length === 0;
    elements.noResults.hidden = projects.length === 0 || filteredProjects.length > 0;
    renderDiagramProjectOptions();

    elements.projectList.innerHTML = filteredProjects.map(function (project) {
      const primaryPhoto = project.photos && project.photos[0];
      const imageUrl = primaryPhoto ? (primaryPhoto.downloadUrl || (primaryPhoto.blob ? createObjectUrl(primaryPhoto.blob) : "img/icono_croche.png")) : "img/icono_croche.png";
      const imageAlt = primaryPhoto ? (primaryPhoto.label || primaryPhoto.name || project.name) : project.name;
      const description = project.description || "Sin descripción";
      return '<article class="project-card">' +
        '<button class="project-cover" type="button" data-action="open" data-id="' + escapeHtml(project.id) + '" aria-label="Abrir proyecto ' + escapeHtml(project.name) + '">' +
        '<img src="' + imageUrl + '" alt="' + escapeHtml(imageAlt) + '">' +
        '<span class="photo-count-badge">▧ ' + (project.photos ? project.photos.length : 0) + '</span></button>' +
        '<div class="project-card-body"><p class="project-type">' + escapeHtml(project.garment) + '</p>' +
        '<h3 title="' + escapeHtml(project.name) + '">' + escapeHtml(project.name) + '</h3>' +
        '<p class="project-description" title="' + escapeHtml(description) + '">' + escapeHtml(description) + '</p>' +
        '<div class="project-card-actions"><span class="project-date">' + formatDate(project.updatedAt) + '</span>' +
        '<span><button class="card-action" type="button" data-action="edit" data-id="' + escapeHtml(project.id) + '">Editar</button>' +
        '<button class="card-action delete" type="button" data-action="delete" data-id="' + escapeHtml(project.id) + '">Eliminar</button></span></div></div></article>';
    }).join("");
  }

  function refreshProjects() {
    return getAllProjects().then(function (savedProjects) {
      savedProjects.forEach(function (savedProj) {
        const existingProj = projects.find(function (p) { return p.id === savedProj.id; });
        if (existingProj && Array.isArray(existingProj.photos)) {
          (savedProj.photos || []).forEach(function (savedPhoto) {
            const existingPhoto = existingProj.photos.find(function (p) { return p.id === savedPhoto.id; });
            if (existingPhoto && existingPhoto.blob instanceof Blob) {
              savedPhoto.blob = existingPhoto.blob;
            }
          });
        }
      });
      projects = savedProjects.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
      renderProjects();
    });
  }

  function closeProjectDialog() {
    elements.projectDialog.close();
    elements.projectForm.reset();
    stagedPhotos.forEach(function (photo) { URL.revokeObjectURL(photo.url); });
    stagedPhotos = [];
    editingProjectId = null;
    elements.photoStaging.innerHTML = "";
    elements.photoInput.value = "";
  }

  elements.projectDialog.addEventListener("close", function () {
    stagedPhotos.forEach(function (photo) { URL.revokeObjectURL(photo.url); });
    stagedPhotos = [];
    editingProjectId = null;
    elements.photoStaging.innerHTML = "";
    elements.photoInput.value = "";
  });

  function renderStagedPhotos() {
    elements.photoStaging.innerHTML = stagedPhotos.map(function (photo, index) {
      return '<div class="staged-photo" data-photo-index="' + index + '">' +
        '<img src="' + photo.url + '" alt="Vista previa de ' + escapeHtml(photo.label) + '">' +
        '<label class="field">' + (index === 0 ? '<span class="primary-photo-label">Foto principal</span>' : '<span>Etiqueta de la foto</span>') +
        '<input type="text" maxlength="70" value="' + escapeHtml(photo.label) + '" data-photo-label="' + index + '" aria-label="' + (index === 0 ? "Etiqueta de la foto principal" : "Etiqueta de la foto " + (index + 1)) + '"></label>' +
        '<button class="remove-photo" type="button" data-remove-photo="' + index + '" aria-label="Quitar fotografía">×</button></div>';
    }).join("");
  }

  function openNewProject() {
    editingProjectId = null;
    stagedPhotos = [];
    elements.projectForm.reset();
    elements.dialogTitle.textContent = "Nuevo proyecto";
    elements.saveButton.textContent = "Crear proyecto";
    elements.photoStaging.innerHTML = "";
    elements.projectDialog.showModal();
    elements.name.focus();
  }

  function openEditProject(project) {
    editingProjectId = project.id;
    elements.projectForm.reset();
    elements.name.value = project.name;
    elements.garment.value = project.garment;
    elements.description.value = project.description;
    elements.dialogTitle.textContent = "Editar proyecto";
    elements.saveButton.textContent = "Guardar cambios";
    stagedPhotos = project.photos.map(function (photo) {
      const url = photo.downloadUrl || (photo.blob ? URL.createObjectURL(photo.blob) : "");
      return {
        id: photo.id,
        label: photo.label || photo.name || "",
        name: photo.name || photo.label || "Fotografía",
        blob: photo.blob || null,
        downloadUrl: photo.downloadUrl || null,
        storagePath: photo.storagePath || null,
        url: url,
        isNew: false
      };
    });
    renderStagedPhotos();
    elements.projectDialog.showModal();
    elements.name.focus();
  }

  function openProjectDetail(project) {
    clearDetailObjectUrls();
    const photosHtml = project.photos.map(function (photo, index) {
      const photoSrc = photo.downloadUrl || (photo.blob ? createDetailObjectUrl(photo.blob) : "");
      return '<figure class="detail-photo"><img src="' + photoSrc + '" alt="' + escapeHtml(photo.label || photo.name || project.name) + '">' +
        '<figcaption><span>' + escapeHtml(photo.label || photo.name || "Fotografía") + '</span>' +
        (index === 0 ? "<span>Principal</span>" : "<span>Complementaria</span>") + '</figcaption></figure>';
    }).join("");
    const isAiReady = Boolean(aiAnalysis && aiAnalysis.isConfigured());
    const aiNoticeHtml = isAiReady
      ? '<div class="analysis-notice"><span aria-hidden="true">✦</span><div><strong>Análisis con IA disponible en el Boceto visual</strong>' +
        '<p>Abre el boceto visual para analizar las fotos con Gemini e identificar automáticamente la silueta y los puntos de croché.</p></div></div>'
      : '<div class="analysis-notice"><span aria-hidden="true">✳</span><div><strong>Análisis con IA no conectado</strong>' +
        '<p>Configura tu clave de Gemini en <code>js/config.js</code> para analizar fotos. Mientras tanto, puedes preparar el boceto visual marcando los puntos a mano.</p></div></div>';
    const diagramActionLabel = isAiReady ? "Abrir boceto y analizar con IA" : "Crear boceto visual";

    elements.projectDetail.innerHTML = '<div class="detail-content"><div class="detail-top"><div>' +
      '<p class="eyebrow">' + escapeHtml(project.garment) + '</p><h2 class="detail-title" id="detail-title">' + escapeHtml(project.name) + '</h2>' +
      '<p class="detail-meta">Actualizado el ' + formatDate(project.updatedAt) + ' · ' + project.photos.length + (project.photos.length === 1 ? " fotografía" : " fotografías") + '</p></div>' +
      '<button class="icon-button" type="button" data-detail-close aria-label="Cerrar">×</button></div>' +
      (project.description ? '<p class="detail-description">' + escapeHtml(project.description) + '</p>' : "") +
      '<div class="detail-gallery">' + photosHtml + '</div>' +
      aiNoticeHtml +
      '<div class="detail-diagram-action"><button class="button button-primary" type="button" data-open-diagram="' + escapeHtml(project.id) + '">' + escapeHtml(diagramActionLabel) + '</button></div></div>';
    elements.detailDialog.showModal();
  }

  function setView(view) {
    const activeView = ["projects", "symbols", "diagram"].includes(view) ? view : "projects";
    const labels = {
      projects: "Mis proyectos",
      symbols: "Símbolos de croché",
      diagram: "Boceto visual"
    };
    elements.projectsPage.hidden = activeView !== "projects";
    elements.catalogPage.hidden = activeView !== "symbols";
    elements.diagramPage.hidden = activeView !== "diagram";
    elements.currentPageLabel.textContent = labels[activeView];
    document.title = activeView === "projects"
      ? "CrochéLab — Taller de patrones"
      : labels[activeView] + " — CrochéLab";
    document.querySelectorAll(".nav-link[data-view]").forEach(function (link) {
      const active = link.dataset.view === activeView;
      link.classList.toggle("active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    if (activeView === "diagram") {
      updateAiControls();
    }
    window.scrollTo(0, 0);
  }

  function renderSymbols() {
    const query = elements.symbolSearch.value.trim().toLocaleLowerCase("es");
    const filteredSymbols = symbolLibrary.all().filter(function (symbol) {
      const matchesCategory = selectedSymbolCategory === "all" || symbol.category === selectedSymbolCategory;
      const searchableText = (symbol.name + " " + symbol.abbreviation + " " + symbol.description).toLocaleLowerCase("es");
      return matchesCategory && searchableText.includes(query);
    });
    elements.symbolGrid.innerHTML = filteredSymbols.map(function (symbol) {
      return '<button class="symbol-card" type="button" data-symbol-id="' + escapeHtml(symbol.id) + '" aria-label="Ver símbolo: ' + escapeHtml(symbol.name) + '">' +
        '<span class="symbol-card-art" aria-hidden="true">' + symbolLibrary.render(symbol.id, 48) + '</span>' +
        '<span class="symbol-card-title">' + escapeHtml(symbol.name) + '</span>' +
        '<span class="symbol-card-meta"><span>' + escapeHtml(symbol.categoryLabel) + '</span><span class="symbol-abbreviation">' + escapeHtml(symbol.abbreviation) + '</span></span></button>';
    }).join("");
    elements.symbolCount.textContent = filteredSymbols.length + (filteredSymbols.length === 1 ? " símbolo" : " símbolos");
    elements.symbolEmpty.hidden = filteredSymbols.length > 0;
  }

  function openSymbolDetail(symbolId) {
    const symbol = symbolLibrary.get(symbolId);
    if (!symbol) return;
    elements.symbolDetail.innerHTML = '<div class="symbol-detail-content"><div class="symbol-detail-heading"><div>' +
      '<p class="eyebrow">' + escapeHtml(symbol.categoryLabel) + '</p><h2 class="symbol-detail-title" id="symbol-detail-title">' + escapeHtml(symbol.name) + '</h2></div>' +
      '<button class="icon-button" type="button" data-symbol-close aria-label="Cerrar">×</button></div>' +
      '<div class="symbol-large-art">' + symbolLibrary.render(symbol.id, 84) + '</div>' +
      '<p class="symbol-detail-abbreviation">' + escapeHtml(symbol.abbreviation) + '</p>' +
      '<p class="symbol-detail-description">' + escapeHtml(symbol.description) + '</p></div>';
    elements.symbolDialog.showModal();
  }

  function onFilesSelected(event) {
    const selectedFiles = Array.from(event.target.files || []);
    const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
    const invalidFiles = selectedFiles.filter(function (file) { return !supportedTypes.includes(file.type); });
    if (invalidFiles.length) {
      showToast("Solo se pueden añadir archivos de imagen.", true);
    }

    const validFiles = selectedFiles.filter(function (file) { return supportedTypes.includes(file.type); });
    validFiles.forEach(function (file) {
      stagedPhotos.push({
        id: crypto.randomUUID(),
        label: file.name.replace(/\.[^.]+$/, ""),
        name: file.name,
        blob: file,
        url: URL.createObjectURL(file),
        isNew: true
      });
    });
    renderStagedPhotos();
    event.target.value = "";
  }

  function onFormSubmit(event) {
    event.preventDefault();
    if (!elements.projectForm.reportValidity()) return;
    if (!stagedPhotos.length) {
      showToast("Añade al menos una fotografía para crear el proyecto.", true);
      return;
    }
    const existingProject = projects.find(function (project) { return project.id === editingProjectId; });
    const now = new Date().toISOString();
    const project = {
      id: editingProjectId || crypto.randomUUID(),
      name: elements.name.value.trim(),
      garment: elements.garment.value,
      description: elements.description.value.trim(),
      createdAt: existingProject ? existingProject.createdAt : now,
      updatedAt: now,
      photos: stagedPhotos.map(function (photo) {
        return {
          id: photo.id,
          label: photo.label.trim(),
          name: photo.name,
          blob: photo.blob || null,
          downloadUrl: photo.downloadUrl || null,
          storagePath: photo.storagePath || null,
          type: (photo.blob && photo.blob.type) || "image/jpeg"
        };
      })
    };

    elements.saveButton.disabled = true;
    saveProject(project).then(function () {
      closeProjectDialog();
      return refreshProjects();
    }).then(function () {
      showToast(existingProject ? "Proyecto actualizado." : "Proyecto creado.");
    }).catch(function (error) {
      console.error("No se pudo guardar el proyecto:", error);
      showToast("No se pudo guardar el proyecto. Comprueba el espacio disponible en el navegador.", true);
    }).finally(function () {
      elements.saveButton.disabled = false;
    });
  }

  function onProjectListClick(event) {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const project = projects.find(function (item) { return item.id === actionButton.dataset.id; });
    if (!project) return;

    if (actionButton.dataset.action === "open") {
      openProjectDetail(project);
    } else if (actionButton.dataset.action === "edit") {
      openEditProject(project);
    } else if (actionButton.dataset.action === "delete") {
      if (!window.confirm('¿Eliminar "' + project.name + '" y sus fotografías? Esta acción no se puede deshacer.')) return;
      deleteProject(project.id, project.photos).then(refreshProjects).then(function () {
        showToast("Proyecto eliminado.");
      }).catch(function (error) {
        console.error("No se pudo eliminar el proyecto:", error);
        showToast("No se pudo eliminar el proyecto.", true);
      });
    }
  }

  elements.projectList.addEventListener("click", onProjectListClick);
  elements.search.addEventListener("input", renderProjects);
  elements.photoInput.addEventListener("change", onFilesSelected);
  elements.projectForm.addEventListener("submit", onFormSubmit);
  elements.projectForm.addEventListener("input", function (event) {
    const index = event.target.dataset.photoLabel;
    if (index !== undefined && stagedPhotos[index]) {
      stagedPhotos[index].label = event.target.value;
    }
  });
  elements.photoStaging.addEventListener("click", function (event) {
    const removeButton = event.target.closest("[data-remove-photo]");
    if (!removeButton) return;
    const index = Number(removeButton.dataset.removePhoto);
    const removed = stagedPhotos.splice(index, 1)[0];
    if (removed) URL.revokeObjectURL(removed.url);
    renderStagedPhotos();
  });

  document.getElementById("new-project-button").addEventListener("click", openNewProject);
  document.getElementById("empty-create-button").addEventListener("click", openNewProject);
  document.getElementById("close-dialog-button").addEventListener("click", closeProjectDialog);
  document.getElementById("cancel-dialog-button").addEventListener("click", closeProjectDialog);
  elements.detailDialog.addEventListener("click", function (event) {
    const diagramButton = event.target.closest("[data-open-diagram]");
    if (diagramButton) {
      const projectId = diagramButton.dataset.openDiagram;
      elements.detailDialog.close();
      elements.diagramProjectSelect.value = projectId;
      setView("diagram");
      loadPatternForProject(projectId);
      return;
    }
    if (event.target === elements.detailDialog || event.target.closest("[data-detail-close]")) {
      elements.detailDialog.close();
      clearDetailObjectUrls();
    }
  });
  elements.detailDialog.addEventListener("close", clearDetailObjectUrls);
  document.querySelectorAll(".nav-link[data-view]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      setView(link.dataset.view);
    });
  });
  elements.symbolSearch.addEventListener("input", renderSymbols);
  elements.symbolFilters.addEventListener("click", function (event) {
    const filter = event.target.closest("[data-category]");
    if (!filter) return;
    selectedSymbolCategory = filter.dataset.category;
    elements.symbolFilters.querySelectorAll("[data-category]").forEach(function (button) {
      const active = button === filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderSymbols();
  });
  elements.symbolGrid.addEventListener("click", function (event) {
    const card = event.target.closest("[data-symbol-id]");
    if (card) openSymbolDetail(card.dataset.symbolId);
  });
  elements.symbolDialog.addEventListener("click", function (event) {
    if (event.target === elements.symbolDialog || event.target.closest("[data-symbol-close]")) {
      elements.symbolDialog.close();
    }
  });
  elements.diagramProjectSelect.addEventListener("change", function () {
    loadPatternForProject(elements.diagramProjectSelect.value);
  });
  elements.diagramPhotoStrip.addEventListener("click", function (event) {
    const photoButton = event.target.closest("[data-photo-id]");
    if (!photoButton) return;
    const project = getSelectedDiagramProject();
    if (!project) return;
    selectedDiagramPhotoId = photoButton.dataset.photoId;
    renderDiagramPhotoGallery(project, selectedDiagramPhotoId);
  });
  elements.diagramRenderButton.addEventListener("click", renderDiagramFromEditor);
  elements.aiAnalyzeButton.addEventListener("click", analyzeSelectedProject);
  elements.diagramSaveButton.addEventListener("click", saveRenderedPattern);
  elements.diagramDownloadButton.addEventListener("click", downloadRenderedSvg);
  elements.sketchStitchChoices.addEventListener("change", function () {
    updateSketchControls();
    if (getSelectedDiagramProject() && getSelectedStitchIds().length) renderDiagramFromEditor();
    else resetDiagramPreview();
  });
  document.querySelectorAll('input[name="sketch-shape"]').forEach(function (input) {
    input.addEventListener("change", function () {
      if (getSelectedDiagramProject() && getSelectedStitchIds().length) renderDiagramFromEditor();
    });
  });
  elements.sketchRows.addEventListener("input", function () {
    updateSketchControls();
    if (getSelectedDiagramProject() && getSelectedStitchIds().length) renderDiagramFromEditor();
  });

  if (!symbolLibrary) {
    console.error("No se pudo cargar el catálogo de símbolos de CrochéLab.");
    elements.symbolGrid.textContent = "No se pudo cargar la biblioteca de símbolos.";
  } else {
    renderSymbols();
  }
  if (!diagramEngine) {
    console.error("No se pudo cargar el motor de diagramas de CrochéLab.");
    showDiagramMessages(["El motor de diagramas no está disponible."], [], "");
    elements.diagramRenderButton.disabled = true;
    elements.diagramSaveButton.disabled = true;
  }
  if (symbolLibrary) renderStitchChoices();
  updateAiControls();

  function updateAuthUI(user) {
    if (user) {
      if (elements.userAvatar) {
        if (user.photoURL) {
          elements.userAvatar.innerHTML = '<img src="' + escapeHtml(user.photoURL) + '" alt="' + escapeHtml(user.displayName || "Usuario") + '">';
        } else {
          elements.userAvatar.innerHTML = "";
          elements.userAvatar.textContent = (user.displayName || user.email || "U").charAt(0).toUpperCase();
        }
      }
      if (elements.userDisplayName) {
        elements.userDisplayName.textContent = user.displayName || "Mi taller";
      }
      if (elements.userStatusText) {
        elements.userStatusText.textContent = user.email || "Conectado a Firestore";
      }
      if (elements.authButton) {
        elements.authButton.textContent = "Salir";
        elements.authButton.title = "Cerrar sesión de Google";
      }
      if (elements.storageStatusBadge) {
        elements.storageStatusBadge.classList.add("cloud-badge");
        elements.storageStatusBadge.innerHTML = '<span aria-hidden="true">☁</span> Guardado en Firestore';
      }
    } else {
      if (elements.userAvatar) {
        elements.userAvatar.innerHTML = '<img src="img/icono_croche.png" alt="Mi taller">';
      }
      if (elements.userDisplayName) {
        elements.userDisplayName.textContent = "Mi taller";
      }
      if (elements.userStatusText) {
        elements.userStatusText.textContent = "Modo local";
      }
      if (elements.authButton) {
        elements.authButton.textContent = "Entrar";
        elements.authButton.title = "Iniciar sesión con Google";
      }
      if (elements.storageStatusBadge) {
        elements.storageStatusBadge.classList.remove("cloud-badge");
        elements.storageStatusBadge.innerHTML = '<span aria-hidden="true"></span> Guardado en este dispositivo';
      }
    }
  }

  if (elements.authButton) {
    elements.authButton.addEventListener("click", function () {
      if (!firebaseService) return;
      if (firebaseService.isCloudActive()) {
        firebaseService.logout().then(function () {
          showToast("Sesión cerrada.");
        }).catch(function (error) {
          console.error("Error al cerrar sesión:", error);
          showToast("Error al cerrar sesión.", true);
        });
      } else {
        firebaseService.loginWithGoogle().then(function () {
          showToast("Sesión iniciada con Google.");
        }).catch(function (error) {
          console.error("Error al iniciar sesión con Google:", error);
          if (error && error.code !== "auth/popup-closed-by-user") {
            showToast("No se pudo iniciar sesión: " + (error.message || "Error"), true);
          }
        });
      }
    });
  }

  if (firebaseService) {
    firebaseService.init();
    firebaseService.onAuthChange(function (user) {
      updateAuthUI(user);
      refreshProjects();
    });
  }

  openDatabase().then(refreshProjects).catch(function (error) {
    console.error("No se pudo iniciar CrochéLab:", error);
    elements.emptyState.hidden = true;
    elements.projectList.hidden = true;
    elements.noResults.hidden = false;
    elements.noResults.textContent = "No se pudo abrir el almacenamiento local. Comprueba que el navegador permita guardar datos y recarga la página.";
    showToast("No se pudo iniciar el almacenamiento local.", true);
  });
}());
