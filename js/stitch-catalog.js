(function () {
  "use strict";

  const symbols = [
    {
      id: "chain",
      name: "Cadeneta",
      abbreviation: "cad",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Bucle ovalado que representa una cadeneta. Varias cadenetas pueden formar una base o un arco.",
      markup: '<ellipse cx="24" cy="24" rx="5.5" ry="10" transform="rotate(-38 24 24)"/>'
    },
    {
      id: "slip-stitch",
      name: "Punto deslizado",
      abbreviation: "pd",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Punto bajo y compacto, representado aquí como un círculo pequeño relleno.",
      markup: '<circle cx="24" cy="24" r="3.5" fill="currentColor" stroke="none"/>'
    },
    {
      id: "single-crochet",
      name: "Punto bajo",
      abbreviation: "pb",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "La cruz es una convención frecuente para el punto bajo en diagramas de croché.",
      markup: '<path d="M16 16l16 16M32 16L16 32"/>'
    },
    {
      id: "half-double-crochet",
      name: "Punto medio alto",
      abbreviation: "pma",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "La T representa el punto medio alto; confirma siempre la leyenda del patrón.",
      markup: '<path d="M24 13v23M15 20h18"/>'
    },
    {
      id: "double-crochet",
      name: "Punto alto",
      abbreviation: "pa",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Poste vertical con barra diagonal, una notación habitual para el punto alto.",
      markup: '<path d="M24 12v25M15 20h18M18 29l12-12"/>'
    },
    {
      id: "treble-crochet",
      name: "Punto alto doble",
      abbreviation: "pad",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Poste con dos barras diagonales para distinguirlo del punto alto sencillo.",
      markup: '<path d="M24 12v25M15 20h18M18 27l12-12M18 33l12-12"/>'
    },
    {
      id: "double-treble-crochet",
      name: "Punto alto triple",
      abbreviation: "pat",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Poste con tres barras diagonales. La altura del símbolo es esquemática.",
      markup: '<path d="M24 12v25M15 20h18M18 25l12-12M18 31l12-12M18 37l12-12"/>'
    },
    {
      id: "increase",
      name: "Aumento de punto bajo",
      abbreviation: "aum",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Dos puntos bajos nacen de una misma base para añadir un punto en la vuelta.",
      markup: '<path d="M24 34V27M24 27L15 15M24 27l9-12M12 12l6 6M30 18l6-6"/>'
    },
    {
      id: "decrease",
      name: "Disminución de punto bajo",
      abbreviation: "dism",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Dos puntos bajos se trabajan juntos y convergen en una salida común.",
      markup: '<path d="M13 14l9 12M35 14l-9 12M22 26l2 3 2-3M24 29v8M10 11l6 6M38 11l-6 6"/>'
    },
    {
      id: "cluster",
      name: "Punto agrupado",
      abbreviation: "grupo",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Tres postes incompletos comparten el cierre superior. La cantidad de postes depende del patrón.",
      markup: '<path d="M24 14L15 32M24 14l9 18M24 14v18M12 35l3-3 3 3M21 35l3-3 3 3M30 35l3-3 3 3M24 14v5M21 19h6"/>'
    },
    {
      id: "fan",
      name: "Abanico",
      abbreviation: "aban.",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Varios postes parten de una base común para formar un abanico. Su número se indica en las instrucciones.",
      markup: '<path d="M24 34L12 14M24 34L18 12M24 34V11M24 34l6-22M24 34l12-20M10 12l4 4M16 10l4 4M22 9v5M29 9l-1 5M38 12l-4 4"/>'
    },
    {
      id: "chain-space",
      name: "Arco de cadenetas",
      abbreviation: "arco",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Arco esquemático entre dos puntos de anclaje; el número de cadenetas se especifica aparte.",
      markup: '<path d="M12 32C12 15 36 15 36 32"/><ellipse cx="12" cy="33" rx="3" ry="5" transform="rotate(-38 12 33)"/><ellipse cx="36" cy="33" rx="3" ry="5" transform="rotate(38 36 33)"/>'
    },
    {
      id: "repeat",
      name: "Grupo repetido",
      abbreviation: "rep.",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Marca editorial para señalar un fragmento que se repite. No sustituye a la leyenda ni a las instrucciones.",
      markup: '<path d="M16 12h-5v24h5M32 12h5v24h-5M21 17l-3 7h5l-3 7M30 17l-3 7h5l-3 7"/>'
    }
  ];

  function render(id, size) {
    const symbol = symbols.find(function (item) { return item.id === id; });
    if (!symbol) {
      throw new Error("Símbolo de croché desconocido: " + id);
    }
    const dimension = Number.isFinite(size) && size > 0 ? Math.round(size) : 48;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dimension + '" height="' + dimension +
      '" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="' +
      symbol.name + '">' + symbol.markup + '</svg>';
  }

  window.CrocheLabSymbols = Object.freeze({
    all: function () { return symbols.slice(); },
    get: function (id) {
      return symbols.find(function (item) { return item.id === id; }) || null;
    },
    render: render
  });
}());
