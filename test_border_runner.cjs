const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = __dirname;
const windowContext = {};

vm.runInNewContext(fs.readFileSync(path.join(root, "js", "stitch-catalog.js"), "utf8"), {
  window: windowContext
});
vm.runInNewContext(fs.readFileSync(path.join(root, "js", "diagram-engine.js"), "utf8"), {
  window: windowContext
});

const engine = windowContext.CrocheLabDiagram;

const pattern = engine.createSketch({
  projectId: "project-1",
  photos: [{ id: "photo-1", label: "Vista general" }],
  shape: "border",
  rows: 3,
  selectedStitchIds: ["chain", "double-crochet", "single-crochet", "picot"]
});

const result = engine.validate(pattern);
console.log("Validation result for border sketch with 3 rows:", result);
assert.equal(result.errors.length, 0);
assert.equal(result.warnings.length, 0);
assert.equal(result.roundCount, 3);
assert.equal(pattern.construction.method, "bottom-up");

const pattern4 = engine.createSketch({
  projectId: "project-1",
  photos: [{ id: "photo-1", label: "Vista general" }],
  shape: "border",
  rows: 4,
  selectedStitchIds: ["chain", "double-crochet", "single-crochet", "picot"]
});
const result4 = engine.validate(pattern4);
console.log("Validation result for border sketch with 4 rows:", result4);
assert.equal(result4.errors.length, 0);
assert.equal(result4.warnings.length, 0);
assert.equal(result4.roundCount, 4);

console.log("All border tests passed!");
            worksInto: [],
            notes: "Punto de anclaje inicial de la orilla."
          });
        }

        [-75, -50, -25].forEach(function (offset) {
          stitches.push({
            id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
            symbolId: baseStitch,
            position: { x: mCenter + offset, y: roundY },
            worksInto: [],
            notes: "Cadeneta de base de la puntilla."
          });
        });

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: baseStitch,
          position: { x: mCenter, y: roundY - 6 },
          worksInto: [],
          notes: "Anillo / arco base del abanico " + (mIndex + 1) + "."
        });

        [25, 50, 75].forEach(function (offset) {
          stitches.push({
            id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
            symbolId: baseStitch,
            position: { x: mCenter + offset, y: roundY },
            worksInto: [],
            notes: "Cadeneta de base de la puntilla."
          });
        });

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: anchorStitch,
          position: { x: rightBound, y: roundY },
          worksInto: [],
          notes: "Punto bajo de unión entre festones."
        });
      });
    } else if (rIndex === fanRoundIndex) {
      const fanAngles = [-42, -28, -14, 0, 14, 28, 42];
      motifCenters.forEach(function (mCenter, mIndex) {
        const leftBound = mCenter - motifSpacing / 2;
        const rightBound = mCenter + motifSpacing / 2;

        if (mIndex === 0) {
          stitches.push({
            id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
            symbolId: anchorStitch,
            position: { x: leftBound, y: roundY + 16 },
            worksInto: [],
            notes: "Punto de anclaje de la vuelta de abanicos."
          });
        }

        fanAngles.forEach(function (angle, fIndex) {
          stitches.push({
            id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
            symbolId: tallStitch,
            position: {
              x: mCenter - 24 + (fIndex - 3) * 1.8,
              y: roundY - 14
            },
            rotation: angle,
            rotationOrigin: { x: 24, y: 37 },
            worksInto: [],
            notes: "Punto alto del abanico (" + angle + "°)."
          });
        });

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: anchorStitch,
          position: { x: rightBound, y: roundY + 16 },
          worksInto: [],
          notes: "Punto bajo de separación entre abanicos."
        });
      });
    } else if (rIndex === crownRoundIndex) {
      motifCenters.forEach(function (mCenter, mIndex) {
        const leftBound = mCenter - motifSpacing / 2;
        const rightBound = mCenter + motifSpacing / 2;

        if (mIndex === 0) {
          stitches.push({
            id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
            symbolId: anchorStitch,
            position: { x: leftBound, y: roundY + 28 },
            worksInto: [],
            notes: "Punto de fijación del arco lateral."
          });
        }

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: baseStitch,
          position: { x: mCenter - 72, y: roundY + 16 },
          rotation: -30,
          rotationOrigin: { x: 24, y: 24 },
          worksInto: [],
          notes: "Arco de cadenetas ascendente."
        });
        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: baseStitch,
          position: { x: mCenter - 40, y: roundY },
          rotation: -15,
          rotationOrigin: { x: 24, y: 24 },
          worksInto: [],
          notes: "Arco de cadenetas hacia la cúspide."
        });

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: crownStitch,
          position: { x: mCenter - 24, y: roundY - 22 },
          worksInto: [],
          notes: "Picot decorativo en la coronilla del festón."
        });

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: baseStitch,
          position: { x: mCenter + 16, y: roundY },
          rotation: 15,
          rotationOrigin: { x: 24, y: 24 },
          worksInto: [],
          notes: "Arco de cadenetas descendente."
        });
        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: baseStitch,
          position: { x: mCenter + 48, y: roundY + 16 },
          rotation: 30,
          rotationOrigin: { x: 24, y: 24 },
          worksInto: [],
          notes: "Arco de cadenetas hacia el anclaje."
        });

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: anchorStitch,
          position: { x: rightBound, y: roundY + 28 },
          worksInto: [],
          notes: "Anclaje entre festones coronados."
        });
      });
    } else {
      motifCenters.forEach(function (mCenter, mIndex) {
        const leftBound = mCenter - motifSpacing / 2;
        const rightBound = mCenter + motifSpacing / 2;

        if (mIndex === 0) {
          stitches.push({
            id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
            symbolId: anchorStitch,
            position: { x: leftBound, y: roundY },
            worksInto: [],
            notes: "Punto de base en hilera intermedia."
          });
        }

        [-80, -40, 0, 40, 80].forEach(function (offset, idx) {
          const sym = idx % 2 === 0 ? tallStitch : baseStitch;
          stitches.push({
            id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
            symbolId: sym,
            position: { x: mCenter + offset, y: roundY },
            worksInto: [],
            notes: "Punto de red intermedia de la orilla."
          });
        });

        stitches.push({
          id: "sketch-r" + roundNumber + "-s" + (stitchSeq++),
          symbolId: anchorStitch,
          position: { x: rightBound, y: roundY },
          worksInto: [],
          notes: "Punto de unión de hilera intermedia."
        });
      });
    }

    roundData.push({
      number: roundNumber,
      stitchCount: null,
      instructions: "",
      stitches: stitches,
      repeats: []
    });
  }

  return {
    method: "bottom-up",
    rounds: roundData
  };
}

const pattern = engine.createDraft("project-test");
pattern.sketch = {
  shape: "border",
  detailRows: 3,
  selectedStitchIds: ["chain", "double-crochet", "single-crochet", "picot"]
};
pattern.construction = createBorderConstruction(pattern.sketch.selectedStitchIds, 3);

// Let's test with diagram-engine validate once we update it
console.log("Stitches total:", pattern.construction.rounds.reduce((acc, r) => acc + r.stitches.length, 0));


