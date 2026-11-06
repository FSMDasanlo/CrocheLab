(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const symbolLibrary = window.CrocheLabSymbols;
  const outputCounts = {
    chain: 1,
    "slip-stitch": 1,
    "single-crochet": 1,
    "half-double-crochet": 1,
    "double-crochet": 1,
    "treble-crochet": 1,
    "double-treble-crochet": 1,
    "front-post-single-crochet": 1,
    "back-post-single-crochet": 1,
    "front-post-half-double-crochet": 1,
    "back-post-half-double-crochet": 1,
    "front-post-double-crochet": 1,
    "back-post-double-crochet": 1,
    "crab-stitch": 1,
    increase: 2,
    decrease: 1,
    "symbol-increase": 2,
    "two-double-crochet-together": 1,
    "three-double-crochet-together": 1,
    "crossed-double-crochet": 2,
    "two-treble-crochet-together": 1,
    "three-treble-crochet-together": 1,
    "crossed-treble-crochet": 2,
    "two-double-treble-crochet-together": 1,
    "magic-ring": null,
    "sliding-ring": null,
    "starting-ring": null,
    cluster: 1,
    fan: null,
    "v-stitch": null,
    "v-stitch-chain": null,
    "w-stitch": null,
    "w-stitch-chain": null,
    popcorn: null,
    pineapple: null,
    picot: null,
    "picot-chain": null,
    "single-crochet-chain": null,
    "chain-cross": null,
    "chain-space": null
  };
  const allowedSymbolIds = Object.keys(outputCounts);
  const MAX_DIAGRAM_POINTS = 2000;
  const MAX_COORDINATE = 10000;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validate(pattern) {
    const errors = [];
    const warnings = [];
    const addError = function (message) { errors.push(message); };
    const addWarning = function (message) { warnings.push(message); };

    if (!isObject(pattern)) {
      return { errors: ["El patrón debe ser un objeto JSON."], warnings: [] };
    }

    ["schemaVersion", "id", "projectId", "garmentType", "status", "interpretation", "sourceImages", "analysis", "measurements", "materials", "gauge", "construction", "corrections"].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(pattern, key)) {
        addError("Falta el campo obligatorio «" + key + "».");
      }
    });

    if (pattern.schemaVersion !== "1.0.0") addError("La versión del esquema debe ser 1.0.0.");
    if (typeof pattern.id !== "string" || !pattern.id.trim()) addError("El patrón necesita un identificador.");
    if (typeof pattern.projectId !== "string" || !pattern.projectId.trim()) addError("El patrón necesita un proyecto asociado.");
    if (pattern.garmentType !== "triangular-shawl") addError("Este motor solo admite patrones de chal triangular.");
    if (!["draft", "analyzed", "reviewed"].includes(pattern.status)) addError("El estado del patrón no es válido.");
    if (![null, "reconstructed", "proposed"].includes(pattern.interpretation)) addError("El tipo de interpretación no es válido.");
    if (pattern.status === "draft" && pattern.interpretation !== null) addError("Un borrador debe mantener la interpretación sin determinar.");
    if ((pattern.status === "analyzed" || pattern.status === "reviewed") && !pattern.interpretation) {
      addError("Un patrón analizado o revisado debe indicar si es reconstruido o propuesto.");
    }
    if (!Array.isArray(pattern.materials)) addError("materials debe ser una lista.");
    if (pattern.gauge !== null && !isObject(pattern.gauge)) addError("gauge debe ser un objeto o null.");
    if (!isObject(pattern.measurements) || !["cm", "in"].includes(pattern.measurements.unit)) {
      addError("measurements debe indicar una unidad cm o in.");
    } else {
      ["finishedWidth", "finishedDepth"].forEach(function (key) {
        const value = pattern.measurements[key];
        if (value !== null && (!Number.isFinite(value) || value <= 0)) {
          addError("measurements." + key + " debe ser un valor positivo o null.");
        }
      });
    }
    if (!Array.isArray(pattern.corrections)) addError("corrections debe ser una lista.");
    if (pattern.gauge !== null && isObject(pattern.gauge)) {
      if (!["cm", "in"].includes(pattern.gauge.unit)) addError("La muestra debe indicar una unidad cm o in.");
      ["stitches", "rows"].forEach(function (key) {
        const value = pattern.gauge[key];
        if (value !== null && (!Number.isInteger(value) || value < 1)) addError("La muestra " + key + " debe ser un entero positivo o null.");
      });
      ["width", "height"].forEach(function (key) {
        const value = pattern.gauge[key];
        if (value !== null && (!Number.isFinite(value) || value <= 0)) addError("La muestra " + key + " debe ser un valor positivo o null.");
      });
    }
    if (Object.prototype.hasOwnProperty.call(pattern, "sketch")) {
      const sketch = pattern.sketch;
      if (!isObject(sketch)) {
        addError("sketch debe ser un objeto.");
      } else {
        if (!["triangle", "semicircle", "rectangle"].includes(sketch.shape)) {
          addError("La silueta del boceto no es válida.");
        }
        if (!Number.isInteger(sketch.detailRows) || sketch.detailRows < 3 || sketch.detailRows > 12) {
          addError("El nivel de detalle del boceto debe estar entre 3 y 12 filas.");
        }
        if (!Array.isArray(sketch.selectedStitchIds) || sketch.selectedStitchIds.length === 0 ||
            new Set(sketch.selectedStitchIds).size !== sketch.selectedStitchIds.length ||
            sketch.selectedStitchIds.some(function (id) { return !allowedSymbolIds.includes(id); })) {
          addError("El boceto debe incluir tipos de punto válidos y no repetidos.");
        }
      }
    }
    if (Array.isArray(pattern.materials)) {
      pattern.materials.forEach(function (material, index) {
        if (!isObject(material) || typeof material.name !== "string" || !material.name.trim() ||
            !["g", "m", "yd", "skein", "unknown"].includes(material.unit) ||
            (material.amount !== null && (!Number.isFinite(material.amount) || material.amount <= 0))) {
          addError("El material " + (index + 1) + " no tiene nombre, cantidad o unidad válidos.");
        }
      });
    }

    const photoIds = new Set();
    if (!Array.isArray(pattern.sourceImages)) {
      addError("sourceImages debe ser una lista.");
    } else {
      if (pattern.status !== "draft" && pattern.sourceImages.length === 0) {
        addError("Un patrón analizado o revisado debe estar vinculado a al menos una foto fuente.");
      }
      pattern.sourceImages.forEach(function (photo, index) {
        if (!isObject(photo) || typeof photo.photoId !== "string" || !photo.photoId.trim()) {
          addError("La referencia de imagen " + (index + 1) + " no tiene photoId.");
          return;
        }
        if (photoIds.has(photo.photoId)) addError("La imagen «" + photo.photoId + "» está repetida en sourceImages.");
        photoIds.add(photo.photoId);
        if (!["primary", "detail"].includes(photo.role)) addError("La imagen «" + photo.photoId + "» tiene un rol no válido.");
        if (typeof photo.label !== "string") addError("La etiqueta de la imagen «" + photo.photoId + "» debe ser texto.");
      });
    }

    if (!isObject(pattern.analysis)) {
      addError("analysis debe ser un objeto.");
    } else {
      ["findings", "conflicts", "unknowns"].forEach(function (key) {
        if (!Array.isArray(pattern.analysis[key])) addError("analysis." + key + " debe ser una lista.");
      });
      if (Array.isArray(pattern.analysis.findings)) {
        pattern.analysis.findings.forEach(function (finding, index) {
          if (!isObject(finding)) {
            addError("La conclusión " + (index + 1) + " no tiene una estructura válida.");
            return;
          }
          if (typeof finding.id !== "string" || !finding.id.trim() ||
              !["geometry", "stitch", "motif", "repetition", "finishing", "measurement", "other"].includes(finding.topic) ||
              typeof finding.statement !== "string" || !finding.statement.trim() ||
              !["observed", "inferred"].includes(finding.basis) ||
              (finding.confidence !== null && (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1))) {
            addError("La conclusión " + (index + 1) + " contiene campos no válidos.");
          }
          if (!Array.isArray(finding.evidencePhotoIds) || finding.evidencePhotoIds.length === 0) {
            addError("La conclusión " + (index + 1) + " debe indicar al menos una foto como evidencia.");
            return;
          }
          if (new Set(finding.evidencePhotoIds).size !== finding.evidencePhotoIds.length) {
            addError("La conclusión «" + finding.id + "» contiene referencias de foto repetidas.");
          }
          finding.evidencePhotoIds.forEach(function (photoId) {
            if (!photoIds.has(photoId)) addError("La conclusión «" + finding.id + "» refiere una foto que no está en sourceImages: «" + photoId + "».");
          });
        });
      }
      if (Array.isArray(pattern.analysis.conflicts)) {
        pattern.analysis.conflicts.forEach(function (conflict, index) {
          if (!isObject(conflict) || typeof conflict.id !== "string" || !conflict.id.trim() ||
              typeof conflict.description !== "string" || !conflict.description.trim() ||
              !Array.isArray(conflict.evidencePhotoIds) || conflict.evidencePhotoIds.length === 0) {
            addError("El conflicto " + (index + 1) + " debe incluir descripción y fotos de evidencia.");
            return;
          }
          conflict.evidencePhotoIds.forEach(function (photoId) {
            if (!photoIds.has(photoId)) addError("El conflicto «" + conflict.id + "» refiere una foto que no está en sourceImages: «" + photoId + "».");
          });
        });
      }
      if (Array.isArray(pattern.analysis.unknowns)) {
        pattern.analysis.unknowns.forEach(function (unknown, index) {
          if (!isObject(unknown) || typeof unknown.id !== "string" || !unknown.id.trim() ||
              typeof unknown.question !== "string" || !unknown.question.trim()) {
            addError("La incógnita " + (index + 1) + " debe tener ID y pregunta.");
          }
        });
      }
    }

    if (!isObject(pattern.construction) || !Array.isArray(pattern.construction.rounds)) {
      addError("construction.rounds debe ser una lista.");
      return { errors: errors, warnings: warnings };
    }

    const rounds = pattern.construction.rounds;
    if (!["center-out", "bottom-up", "unknown"].includes(pattern.construction.method)) {
      addError("El método de construcción no es válido.");
    }
    if (rounds.length === 0) addError("Añade al menos una vuelta con puntos para dibujar el diagrama.");
    if (pattern.status !== "draft" && rounds.length === 0) addError("Un patrón analizado debe incluir vueltas.");

    const stitchById = new Map();
    const stitchRoundById = new Map();
    let previousRoundIds = new Set();
    let diagramPointCount = 0;
    let pointLimitReported = false;

    rounds.forEach(function (round, roundIndex) {
      const expectedRoundNumber = roundIndex + 1;
      if (!isObject(round)) {
        addError("La vuelta " + expectedRoundNumber + " no tiene una estructura válida.");
        previousRoundIds = new Set();
        return;
      }
      if (round.number !== expectedRoundNumber) {
        addError("Las vueltas deben numerarse consecutivamente desde 1; se esperaba la vuelta " + expectedRoundNumber + ".");
      }
      if (!Array.isArray(round.stitches)) {
        addError("La vuelta " + expectedRoundNumber + " debe contener una lista de puntos.");
        previousRoundIds = new Set();
        return;
      }
      if (typeof round.instructions !== "string") addError("instructions de la vuelta " + expectedRoundNumber + " debe ser texto.");
      if (round.stitches.length === 0) addError("La vuelta " + expectedRoundNumber + " no contiene puntos.");
      if (round.stitchCount !== null && (!Number.isInteger(round.stitchCount) || round.stitchCount < 1)) {
        addError("El conteo declarado de la vuelta " + expectedRoundNumber + " debe ser un entero positivo o null.");
      }

      const currentRoundIds = new Set();
      let calculatedStitchCount = 0;
      let canCalculateStitchCount = true;
      const occupiedPositions = new Set();

      round.stitches.forEach(function (stitch, stitchIndex) {
        if (!isObject(stitch)) {
          addError("El punto " + (stitchIndex + 1) + " de la vuelta " + expectedRoundNumber + " no es válido.");
          return;
        }
        if (typeof stitch.id !== "string" || !stitch.id.trim()) {
          addError("El punto " + (stitchIndex + 1) + " de la vuelta " + expectedRoundNumber + " necesita un ID.");
          return;
        }
        if (diagramPointCount >= MAX_DIAGRAM_POINTS) {
          if (!pointLimitReported) {
            addError("El diagrama supera el límite de " + MAX_DIAGRAM_POINTS + " puntos.");
            pointLimitReported = true;
          }
          return;
        }
        if (stitchById.has(stitch.id)) addError("El ID de punto «" + stitch.id + "» está repetido.");
        if (!allowedSymbolIds.includes(stitch.symbolId) || !symbolLibrary || !symbolLibrary.get(stitch.symbolId)) {
          addError("El punto «" + stitch.id + "» usa un símbolo desconocido: «" + stitch.symbolId + "».");
        } else if (Object.prototype.hasOwnProperty.call(outputCounts, stitch.symbolId) && outputCounts[stitch.symbolId] === null) {
          canCalculateStitchCount = false;
        } else if (Object.prototype.hasOwnProperty.call(outputCounts, stitch.symbolId)) {
          calculatedStitchCount += outputCounts[stitch.symbolId];
        }

        if (!isObject(stitch.position) || !Number.isFinite(stitch.position.x) || !Number.isFinite(stitch.position.y) ||
            Math.abs(stitch.position.x) > MAX_COORDINATE || Math.abs(stitch.position.y) > MAX_COORDINATE) {
          addError("El punto «" + stitch.id + "» debe tener coordenadas x/y finitas dentro de ±" + MAX_COORDINATE + ".");
        } else {
          const positionKey = stitch.position.x + "," + stitch.position.y;
          if (occupiedPositions.has(positionKey)) addWarning("Hay más de un punto en la misma posición en la vuelta " + expectedRoundNumber + ".");
          occupiedPositions.add(positionKey);
        }
        if (!Array.isArray(stitch.worksInto)) {
          addError("worksInto del punto «" + stitch.id + "» debe ser una lista de IDs.");
        } else {
          if (new Set(stitch.worksInto).size !== stitch.worksInto.length) {
            addError("worksInto del punto «" + stitch.id + "» contiene referencias repetidas.");
          }
          stitch.worksInto.forEach(function (targetId) {
            if (!previousRoundIds.has(targetId)) {
              addError("El punto «" + stitch.id + "» enlaza «" + targetId + "», que no pertenece a la vuelta anterior.");
            }
          });
          if (!pattern.sketch && roundIndex > 0 && stitch.worksInto.length === 0) {
            addWarning("El punto «" + stitch.id + "» no declara a qué punto de la vuelta anterior trabaja.");
          }
        }

        if (typeof stitch.notes !== "string") addError("notes del punto «" + stitch.id + "» debe ser texto.");
        stitchById.set(stitch.id, stitch);
        stitchRoundById.set(stitch.id, expectedRoundNumber);
        currentRoundIds.add(stitch.id);
        diagramPointCount += 1;
      });

      if (round.stitchCount !== null && round.stitchCount !== undefined) {
        if (canCalculateStitchCount && round.stitches.every(function (stitch) { return isObject(stitch) && Object.prototype.hasOwnProperty.call(outputCounts, stitch.symbolId); })) {
          if (calculatedStitchCount !== round.stitchCount) {
            addError("La vuelta " + expectedRoundNumber + " declara " + round.stitchCount + " puntos, pero sus símbolos representan " + calculatedStitchCount + ".");
          }
        } else {
          addWarning("No se puede comprobar el conteo de la vuelta " + expectedRoundNumber + " porque incluye símbolos de cantidad variable.");
        }
      }

      if (!Array.isArray(round.repeats)) {
        addError("repeats de la vuelta " + expectedRoundNumber + " debe ser una lista.");
      } else {
        round.repeats.forEach(function (repeat, repeatIndex) {
          if (!isObject(repeat) || typeof repeat.id !== "string" || !repeat.id.trim() ||
              !Array.isArray(repeat.stitchIds) || repeat.stitchIds.length === 0 ||
              !Number.isInteger(repeat.count) || repeat.count < 2) {
            addError("La repetición " + (repeatIndex + 1) + " de la vuelta " + expectedRoundNumber + " no es válida.");
            return;
          }
          if (new Set(repeat.stitchIds).size !== repeat.stitchIds.length) {
            addError("La repetición «" + repeat.id + "» contiene puntos repetidos.");
          }
          repeat.stitchIds.forEach(function (stitchId) {
            if (!currentRoundIds.has(stitchId)) addError("La repetición «" + repeat.id + "» refiere un punto que no pertenece a la vuelta " + expectedRoundNumber + ": «" + stitchId + "».");
          });
        });
      }
      previousRoundIds = currentRoundIds;
    });

    if (diagramPointCount === 0) addError("No hay puntos que representar.");
    return { errors: errors, warnings: warnings, pointCount: diagramPointCount, roundCount: rounds.length, stitchRoundById: stitchRoundById };
  }

  function createSvgElement(name, attributes) {
    const element = document.createElementNS(SVG_NS, name);
    Object.keys(attributes || {}).forEach(function (key) {
      element.setAttribute(key, String(attributes[key]));
    });
    return element;
  }

  function render(pattern) {
    const result = validate(pattern);
    if (result.errors.length) {
      throw new Error(result.errors.join("\n"));
    }

    const rounds = pattern.construction.rounds;
    const allStitches = [];
    rounds.forEach(function (round) {
      round.stitches.forEach(function (stitch) { allStitches.push(stitch); });
    });
    const minX = Math.min.apply(null, allStitches.map(function (stitch) { return stitch.position.x; }));
    const maxX = Math.max.apply(null, allStitches.map(function (stitch) { return stitch.position.x; }));
    const minY = Math.min.apply(null, allStitches.map(function (stitch) { return stitch.position.y; }));
    const maxY = Math.max.apply(null, allStitches.map(function (stitch) { return stitch.position.y; }));
    const isSketch = Boolean(pattern.sketch);
    const selectedSymbols = isSketch
      ? pattern.sketch.selectedStitchIds.map(function (id) { return symbolLibrary.get(id); })
      : [];
    const legendColumns = Math.min(3, selectedSymbols.length);
    const legendRows = Math.ceil(selectedSymbols.length / legendColumns);
    const left = isSketch ? minX - 40 : minX - 100;
    const top = isSketch ? 0 : minY - 30;
    const width = Math.max(220, maxX - minX + (isSketch ? 128 : 160));
    const height = Math.max(100, isSketch ? maxY + 88 : maxY - minY + 100);
    const chartCenterX = (minX + maxX) / 2 + 24;
    const svg = createSvgElement("svg", {
      xmlns: SVG_NS,
      width: width,
      height: height,
      viewBox: left + " " + top + " " + width + " " + height,
      role: "img",
      "aria-label": isSketch
        ? "Boceto triangular de croché con " + result.roundCount + " filas y " + result.pointCount + " símbolos"
        : "Diagrama con " + result.roundCount + " vueltas y " + result.pointCount + " puntos",
      class: "generated-diagram-svg",
      color: isSketch ? "#202020" : "#624d6d"
    });
    const title = createSvgElement("title");
    title.textContent = isSketch && pattern.sketch.shape === "triangle"
      ? "Punto triangular para chales"
      : "Diagrama de croché";
    svg.appendChild(title);

    if (isSketch) {
      const heading = createSvgElement("text", {
        x: chartCenterX,
        y: 38,
        "text-anchor": "middle",
        fill: "#171717",
        "font-family": "Segoe UI, Arial, sans-serif",
        "font-size": 24,
        "font-weight": 500
      });
      heading.textContent = pattern.sketch.shape === "triangle"
        ? "Punto triangular para chales"
        : "Boceto orientativo";
      svg.appendChild(heading);

      const legendWidth = maxX - minX + 88;
      const legendColumnWidth = legendWidth / legendColumns;
      selectedSymbols.forEach(function (symbol, index) {
        const row = Math.floor(index / legendColumns);
        const column = index % legendColumns;
        const itemX = left + column * legendColumnWidth + 4;
        const itemY = 68 + row * 34;
        const source = new DOMParser().parseFromString(symbolLibrary.render(symbol.id, 28), "image/svg+xml").documentElement;
        const symbolGroup = createSvgElement("g", {
          transform: "translate(" + itemX + " " + itemY + ")",
          color: "#171717",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2.2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          class: "diagram-legend-symbol"
        });
        Array.from(source.childNodes).forEach(function (child) {
          symbolGroup.appendChild(document.importNode(child, true));
        });
        svg.appendChild(symbolGroup);
        const label = createSvgElement("text", {
          x: itemX + 32,
          y: itemY + 19,
          fill: "#171717",
          "font-family": "Segoe UI, Arial, sans-serif",
          "font-size": 15
        });
        label.textContent = symbol.name;
        svg.appendChild(label);
      });

      let outline;
      if (pattern.sketch.shape === "triangle") {
        outline = createSvgElement("path", {
          d: "M " + (minX + 6) + " " + (minY + 5) +
            " L " + chartCenterX + " " + (maxY + 68) +
            " L " + (maxX + 42) + " " + (minY + 5),
          fill: "none",
          stroke: "#292929",
          "stroke-width": 1.5,
          class: "diagram-silhouette crochet-chart-outline"
        });
      } else if (pattern.sketch.shape === "semicircle") {
        outline = createSvgElement("path", {
          d: "M " + (minX + 6) + " " + (maxY + 54) +
            " Q " + chartCenterX + " " + (minY - 28) + " " + (maxX + 42) + " " + (maxY + 54) +
            " L " + (minX + 6) + " " + (maxY + 54),
          fill: "none",
          stroke: "#292929",
          "stroke-width": 1.5,
          class: "diagram-silhouette"
        });
      } else {
        outline = createSvgElement("rect", {
          x: minX + 6,
          y: minY + 5,
          width: maxX - minX + 36,
          height: maxY - minY + 58,
          rx: 4,
          fill: "none",
          stroke: "#292929",
          "stroke-width": 1.5,
          class: "diagram-silhouette"
        });
      }
      const firstDrawable = svg.querySelector("title").nextSibling;
      svg.insertBefore(outline, firstDrawable);
      if (pattern.sketch.shape === "triangle" && pattern.sketch.selectedStitchIds.includes("chain")) {
        rounds.forEach(function (round) {
          round.stitches.forEach(function (stitch, index) {
            const previous = round.stitches[index - 1];
            const next = round.stitches[index + 1];
            if (stitch.symbolId !== "chain" || !previous || !next ||
                previous.symbolId === "chain" || next.symbolId === "chain") return;
            const startX = previous.position.x + 24;
            const endX = next.position.x + 24;
            const startY = previous.position.y + 20;
            const endY = next.position.y + 20;
            svg.appendChild(createSvgElement("path", {
              d: "M " + startX + " " + startY + " Q " + (stitch.position.x + 24) + " " + (stitch.position.y + 18) + " " + endX + " " + endY,
              fill: "none",
              stroke: "#292929",
              "stroke-width": 1.1,
              class: "diagram-chain-arch"
            }));
          });
        });
      }
    }

    const linkLayer = createSvgElement("g", { class: "diagram-link-layer" });
    rounds.forEach(function (round) {
      round.stitches.forEach(function (stitch) {
        stitch.worksInto.forEach(function (targetId) {
          const target = allStitches.find(function (candidate) { return candidate.id === targetId; });
          if (!target) return;
          linkLayer.appendChild(createSvgElement("line", {
            x1: stitch.position.x + 24,
            y1: stitch.position.y + 24,
            x2: target.position.x + 24,
            y2: target.position.y + 24,
            class: "diagram-link",
            stroke: "#bdabbf",
            "stroke-width": 1.5,
            "stroke-dasharray": "4 4",
            opacity: 0.85
          }));
        });
      });
    });
    svg.appendChild(linkLayer);

    const roundLabelX = minX - 48;
    rounds.forEach(function (round) {
      const yValues = round.stitches.map(function (stitch) { return stitch.position.y + 24; });
      const labelY = (Math.min.apply(null, yValues) + Math.max.apply(null, yValues)) / 2;
      if (!isSketch) {
        const label = createSvgElement("text", {
          x: roundLabelX,
          y: labelY + 4,
          class: "diagram-round-label",
          "text-anchor": "end",
          fill: "#8c7895",
          "font-family": "Segoe UI, Arial, sans-serif",
          "font-size": 12,
          "font-weight": 600
        });
        label.textContent = "V" + round.number;
        svg.appendChild(label);
      }

      round.stitches.forEach(function (stitch) {
        const source = new DOMParser().parseFromString(symbolLibrary.render(stitch.symbolId, 48), "image/svg+xml").documentElement;
        const group = createSvgElement("g", {
          transform: isSketch
            ? "translate(" + (stitch.position.x - 12) + " " + (stitch.position.y - 12) + ") scale(1.5)"
            : "translate(" + stitch.position.x + " " + stitch.position.y + ")",
          class: "diagram-stitch",
          "data-stitch-id": stitch.id,
          "data-round": round.number,
          "aria-label": symbolLibrary.get(stitch.symbolId).name,
          color: isSketch ? "#202020" : "#624d6d",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2.2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round"
        });
        Array.from(source.childNodes).forEach(function (child) {
          group.appendChild(document.importNode(child, true));
        });
        svg.appendChild(group);
      });
    });
    return svg.outerHTML;
  }

  function createDraft(projectId) {
    return {
      schemaVersion: "1.0.0",
      id: "pattern-" + projectId,
      projectId: projectId,
      garmentType: "triangular-shawl",
      status: "draft",
      interpretation: null,
      sourceImages: [],
      analysis: {
        findings: [],
        conflicts: [],
        unknowns: []
      },
      measurements: {
        unit: "cm",
        finishedWidth: null,
        finishedDepth: null
      },
      materials: [],
      gauge: null,
      construction: {
        method: "unknown",
        rounds: []
      },
      corrections: []
    };
  }

  function createVisualExample(projectId) {
    const pattern = createDraft(projectId);
    pattern.construction.rounds = [
      {
        number: 1,
        stitchCount: 3,
        instructions: "Muestra gráfica sintética; no es una instrucción de tejido.",
        stitches: [
          { id: "r1s1", symbolId: "chain", position: { x: 120, y: 80 }, worksInto: [], notes: "" },
          { id: "r1s2", symbolId: "chain", position: { x: 180, y: 80 }, worksInto: [], notes: "" },
          { id: "r1s3", symbolId: "chain", position: { x: 240, y: 80 }, worksInto: [], notes: "" }
        ],
        repeats: []
      },
      {
        number: 2,
        stitchCount: 3,
        instructions: "Muestra gráfica sintética; no es una instrucción de tejido.",
        stitches: [
          { id: "r2s1", symbolId: "single-crochet", position: { x: 120, y: 160 }, worksInto: ["r1s1"], notes: "" },
          { id: "r2s2", symbolId: "double-crochet", position: { x: 180, y: 160 }, worksInto: ["r1s2"], notes: "" },
          { id: "r2s3", symbolId: "single-crochet", position: { x: 240, y: 160 }, worksInto: ["r1s3"], notes: "" }
        ],
        repeats: []
      }
    ];
    return pattern;
  }

  function createSketch(options) {
    const shape = options && options.shape;
    const rows = options && options.rows;
    const selectedStitchIds = options && options.selectedStitchIds;
    const photos = options && options.photos;
    const projectId = options && options.projectId;
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Selecciona un proyecto válido.");
    }
    if (!Array.isArray(photos)) {
      throw new Error("El proyecto debe incluir una lista de fotografías.");
    }
    if (!["triangle", "semicircle", "rectangle"].includes(shape)) {
      throw new Error("Selecciona una silueta válida.");
    }
    if (!Number.isInteger(rows) || rows < 3 || rows > 12) {
      throw new Error("El nivel de detalle debe estar entre 3 y 12 filas.");
    }
    if (!Array.isArray(selectedStitchIds) || selectedStitchIds.length === 0 ||
        new Set(selectedStitchIds).size !== selectedStitchIds.length ||
        selectedStitchIds.some(function (id) { return !allowedSymbolIds.includes(id) || !symbolLibrary.get(id); })) {
      throw new Error("Selecciona al menos un tipo de punto disponible.");
    }

    const pattern = createDraft(projectId);
    pattern.sketch = {
      shape: shape,
      detailRows: rows,
      selectedStitchIds: selectedStitchIds.slice()
    };
    pattern.sourceImages = photos.map(function (photo, index) {
      return {
        photoId: photo.id,
        role: index === 0 ? "primary" : "detail",
        label: photo.label || photo.name || ""
      };
    });

    const roundData = [];
    const stitchTypes = selectedStitchIds.filter(function (id) { return id !== "chain"; });
    const columnsPerRow = function (rowIndex) {
      if (shape === "triangle") return rowIndex * 2 + 3;
      if (shape === "semicircle") return Math.min(rows * 2 + 1, (rowIndex + 1) * 2 + 3);
      return Math.max(5, Math.min(11, rows));
    };
    const legendRows = Math.ceil(selectedStitchIds.length / Math.min(3, selectedStitchIds.length));
    const chartTop = 170 + (legendRows - 1) * 34;
    const centerX = 600;
    const horizontalSpacing = 42;
    const verticalSpacing = 64;
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      const columnCount = columnsPerRow(rowIndex);
      const startX = centerX - ((columnCount - 1) * horizontalSpacing) / 2 - 24;
      const stitches = [];
      for (let column = 0; column < columnCount; column += 1) {
        let symbolId;
        if (selectedStitchIds.includes("chain") && stitchTypes.length && column % 2 === 1) {
          symbolId = "chain";
        } else if (stitchTypes.length) {
          symbolId = stitchTypes[(rowIndex + Math.floor(column / 2)) % stitchTypes.length];
        } else {
          symbolId = "chain";
        }
        stitches.push({
          id: "sketch-r" + (rowIndex + 1) + "-s" + (column + 1),
          symbolId: symbolId,
          position: {
            x: startX + column * horizontalSpacing,
            y: chartTop + (rows - 1 - rowIndex) * verticalSpacing - 24 - (symbolId === "chain" ? 32 : 0)
          },
          worksInto: [],
          notes: "Distribución visual orientativa; punto no identificado automáticamente."
        });
      }
      roundData.push({
        number: rowIndex + 1,
        stitchCount: null,
        instructions: "",
        stitches: stitches,
        repeats: []
      });
    }
    pattern.construction = {
      method: shape === "triangle" || shape === "semicircle" ? "center-out" : "unknown",
      rounds: roundData
    };
    return pattern;
  }

  window.CrocheLabDiagram = Object.freeze({
    validate: validate,
    render: render,
    createDraft: createDraft,
    createVisualExample: createVisualExample,
    createSketch: createSketch
  });
}());
