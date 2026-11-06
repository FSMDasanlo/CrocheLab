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
      id: "front-post-single-crochet",
      name: "Punto bajo en relieve por delante",
      abbreviation: "pb rel. ad.",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Punto bajo trabajado alrededor del poste por delante; el arco indica el relieve.",
      markup: '<path d="M24 13v24M16 20h16M16 28c3-8 13-8 16 0"/>'
    },
    {
      id: "back-post-single-crochet",
      name: "Punto bajo en relieve por detrás",
      abbreviation: "pb rel. at.",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Punto bajo trabajado alrededor del poste por detrás; la curva se dibuja tras el poste.",
      markup: '<path d="M24 13v24M16 20h16M16 28c3 8 13 8 16 0"/>'
    },
    {
      id: "front-post-half-double-crochet",
      name: "Medio punto alto en relieve por delante",
      abbreviation: "mpa rel. ad.",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Medio punto alto trabajado alrededor del poste por delante.",
      markup: '<path d="M24 13v24M16 20h16M16 28c3-8 13-8 16 0M18 15l4 4"/>'
    },
    {
      id: "back-post-half-double-crochet",
      name: "Medio punto alto en relieve por detrás",
      abbreviation: "mpa rel. at.",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Medio punto alto trabajado alrededor del poste por detrás.",
      markup: '<path d="M24 13v24M16 20h16M16 28c3 8 13 8 16 0M18 15l4 4"/>'
    },
    {
      id: "front-post-double-crochet",
      name: "Punto alto en relieve por delante",
      abbreviation: "pa rel. ad.",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Punto alto trabajado alrededor del poste por delante.",
      markup: '<path d="M24 12v25M16 20h16M16 28c3-8 13-8 16 0M18 29l12-12"/>'
    },
    {
      id: "back-post-double-crochet",
      name: "Punto alto en relieve por detrás",
      abbreviation: "pa rel. at.",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Punto alto trabajado alrededor del poste por detrás.",
      markup: '<path d="M24 12v25M16 20h16M16 28c3 8 13 8 16 0M18 29l12-12"/>'
    },
    {
      id: "crab-stitch",
      name: "Punto cangrejo",
      abbreviation: "pc",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Punto bajo trabajado en sentido inverso para formar un borde firme.",
      markup: '<path d="M23 15v20c0 5 9 5 9 0v-4M14 21h18M18 15l5 5"/>'
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
      id: "symbol-increase",
      name: "Aumento",
      abbreviation: "+",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Marca genérica de aumento; el tipo y la cantidad de puntos dependen de la leyenda del patrón.",
      markup: '<path d="M24 12v24M12 24h24"/>'
    },
    {
      id: "two-double-crochet-together",
      name: "Dos puntos altos juntos",
      abbreviation: "2 pa juntos",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Dos puntos altos se cierran juntos en una sola salida.",
      markup: '<path d="M14 35l8-16M34 35l-8-16M22 19l2-4 2 4M15 27h10M26 27h8M16 31l5-5M27 31l5-5"/>'
    },
    {
      id: "three-double-crochet-together",
      name: "Tres puntos altos juntos",
      abbreviation: "3 pa juntos",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Tres puntos altos incompletos comparten el cierre superior.",
      markup: '<path d="M11 35l11-19M24 35V16M37 35L26 16M22 16l2-4 2 4M11 29h8M20 29h8M29 29h8"/>'
    },
    {
      id: "crossed-double-crochet",
      name: "Punto alto doble cruzado",
      abbreviation: "pa doble cruzado",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Dos puntos altos se cruzan; la dirección exacta puede variar según el patrón.",
      markup: '<path d="M13 36L31 12M35 36L17 12M14 25h10M24 25h10M16 30l6-8M26 30l6-8"/>'
    },
    {
      id: "two-treble-crochet-together",
      name: "Dos puntos altos dobles juntos",
      abbreviation: "2 pa dobles juntos",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Dos puntos altos dobles se cierran juntos en una sola salida.",
      markup: '<path d="M13 36l9-21M35 36l-9-21M22 15l2-4 2 4M12 21h20M16 28h16M17 33l5-7M27 33l5-7"/>'
    },
    {
      id: "three-treble-crochet-together",
      name: "Tres puntos altos dobles juntos",
      abbreviation: "3 pa dobles juntos",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Tres puntos altos dobles incompletos comparten una salida.",
      markup: '<path d="M10 36l12-22M24 36V14M38 36L26 14M22 14l2-4 2 4M10 20h18M21 27h17M13 33h12"/>'
    },
    {
      id: "crossed-treble-crochet",
      name: "Punto alto triple cruzado",
      abbreviation: "pa triple cruzado",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Dos postes altos se cruzan para formar un motivo; confirma la secuencia en la leyenda.",
      markup: '<path d="M13 36L31 11M35 36L17 11M14 20h20M14 28h20M17 33h14"/>'
    },
    {
      id: "two-double-treble-crochet-together",
      name: "Dos puntos altos triples juntos",
      abbreviation: "2 pa triples juntos",
      category: "shaping",
      categoryLabel: "Aumentos y disminuciones",
      description: "Dos puntos altos triples incompletos se cierran en una sola salida.",
      markup: '<path d="M14 36l8-22M34 36l-8-22M22 14l2-4 2 4M13 18h22M13 24h22M13 30h22"/>'
    },
    {
      id: "magic-ring",
      name: "Anillo mágico",
      abbreviation: "am",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Aro ajustable para iniciar un tejido circular; la forma de cierre depende del método.",
      markup: '<ellipse cx="24" cy="24" rx="13" ry="9"/><path d="M11 24h5M32 24h5"/>'
    },
    {
      id: "sliding-ring",
      name: "Anillo deslizado",
      abbreviation: "ad",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Aro de inicio que se cierra tirando de la hebra; sigue la convención del patrón.",
      markup: '<ellipse cx="24" cy="24" rx="10" ry="14"/><path d="M24 10v28M19 18h10M19 30h10"/>'
    },
    {
      id: "starting-ring",
      name: "Anillo de inicio",
      abbreviation: "ai",
      category: "basic",
      categoryLabel: "Puntos básicos",
      description: "Aro inicial representado con una barra transversal.",
      markup: '<ellipse cx="24" cy="24" rx="10" ry="14"/><path d="M15 24h18"/>'
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
      id: "v-stitch",
      name: "V de puntos altos",
      abbreviation: "V pa",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Dos puntos altos forman una V desde una base común; su separación depende del patrón.",
      markup: '<path d="M24 35L13 13M24 35l11-22M13 18l5-5M30 13l5 5"/>'
    },
    {
      id: "v-stitch-chain",
      name: "V de puntos altos con cadeneta",
      abbreviation: "V pa con cad",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Dos puntos altos forman una V con una cadeneta central.",
      markup: '<path d="M24 35L13 13M24 35l11-22M13 18l5-5M30 13l5 5"/><ellipse cx="24" cy="21" rx="2.5" ry="4"/>'
    },
    {
      id: "w-stitch",
      name: "W de puntos altos",
      abbreviation: "W pa",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Grupo de puntos altos con forma de W; el número de puntos puede variar.",
      markup: '<path d="M10 14l8 21 6-14 6 14 8-21M10 19l5-5M33 14l5 5"/>'
    },
    {
      id: "w-stitch-chain",
      name: "W de puntos altos con cadeneta",
      abbreviation: "W pa con cad",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Grupo en W con una cadeneta de separación.",
      markup: '<path d="M10 14l8 21 6-14 6 14 8-21M10 19l5-5M33 14l5 5"/><ellipse cx="24" cy="24" rx="2.5" ry="4"/>'
    },
    {
      id: "popcorn",
      name: "Punto popcorn",
      abbreviation: "pop",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Grupo cerrado que sobresale como una pequeña protuberancia; la cantidad de puntos varía.",
      markup: '<path d="M24 38V31M14 24c0-7 5-12 10-12s10 5 10 12-5 12-10 12-10-5-10-12zM18 20h12M16 25h16M18 30h12"/>'
    },
    {
      id: "pineapple",
      name: "Punto piña",
      abbreviation: "piña",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Motivo abultado de puntos cerrados juntos; su forma depende de las instrucciones.",
      markup: '<path d="M24 10c-7 0-12 6-12 14s5 14 12 14 12-6 12-14-5-14-12-14zM17 17h14M14 23h20M14 29h20M18 35h12M24 10v28"/>'
    },
    {
      id: "picot",
      name: "Punto picot",
      abbreviation: "picot",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Pequeño bucle decorativo de cadenetas cerrado con un punto; la cantidad se especifica aparte.",
      markup: '<path d="M12 34h10M26 34h10M22 34V19l8-8 8 8-8 8"/>'
    },
    {
      id: "picot-chain",
      name: "Punto picot con cadeneta",
      abbreviation: "picot con cad",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Picot decorativo acompañado de una cadeneta de separación.",
      markup: '<path d="M10 34h9M29 34h9M19 34V19l7-7 7 7-7 7"/><ellipse cx="23" cy="34" rx="2.5" ry="4"/>'
    },
    {
      id: "single-crochet-chain",
      name: "Punto bajo con cadeneta",
      abbreviation: "pb con cad",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Punto bajo seguido de una cadeneta; comprueba el orden en las instrucciones.",
      markup: '<path d="M10 16l14 14M24 16L10 30"/><ellipse cx="34" cy="24" rx="4" ry="7" transform="rotate(-38 34 24)"/>'
    },
    {
      id: "chain-cross",
      name: "Cruz de cadenetas",
      abbreviation: "cruz de cad",
      category: "motifs",
      categoryLabel: "Motivos",
      description: "Cuatro pequeños arcos de cadenetas se cruzan en el centro.",
      markup: '<ellipse cx="24" cy="12" rx="3" ry="7"/><ellipse cx="24" cy="36" rx="3" ry="7"/><ellipse cx="12" cy="24" rx="7" ry="3"/><ellipse cx="36" cy="24" rx="7" ry="3"/>'
    },
    {
      id: "two-chains",
      name: "Dos cadenetas",
      abbreviation: "2 cad",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Marca la realización de dos cadenetas; el número se expresa en la propia indicación.",
      markup: '<ellipse cx="17" cy="24" rx="6" ry="4" transform="rotate(-20 17 24)"/><ellipse cx="31" cy="24" rx="6" ry="4" transform="rotate(20 31 24)"/>'
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
      id: "direction-of-work",
      name: "Dirección del tejido",
      abbreviation: "dirección",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Flecha que indica el sentido de lectura o avance del tejido.",
      markup: '<path d="M9 24h28M27 15l10 9-10 9"/>'
    },
    {
      id: "work-start",
      name: "Inicio del trabajo",
      abbreviation: "inicio",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Triángulo que marca el punto de inicio del diagrama.",
      markup: '<path d="M14 11l23 13-23 13z" fill="currentColor" stroke="none"/>'
    },
    {
      id: "work-end",
      name: "Final del trabajo",
      abbreviation: "final",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Cuadrado que marca el final del recorrido en el diagrama.",
      markup: '<rect x="14" y="14" width="20" height="20" fill="currentColor" stroke="none"/>'
    },
    {
      id: "join-slip-stitch",
      name: "Unir con punto deslizado",
      abbreviation: "unir",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Arco con un punto en el extremo que indica una unión con punto deslizado.",
      markup: '<path d="M10 30c2-17 26-17 28 0"/><circle cx="38" cy="30" r="3" fill="currentColor" stroke="none"/>'
    },
    {
      id: "front-loop-only",
      name: "Tomar solo la hebra delantera",
      abbreviation: "hd",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Arco que señala trabajar solo en la hebra delantera.",
      markup: '<path d="M9 29c4-17 26-17 30 0"/>'
    },
    {
      id: "back-loop-only",
      name: "Tomar solo la hebra trasera",
      abbreviation: "ht",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Arco invertido que señala trabajar solo en la hebra trasera.",
      markup: '<path d="M9 19c4 17 26 17 30 0"/>'
    },
    {
      id: "both-loops",
      name: "Tomar ambas hebras",
      abbreviation: "ambas",
      category: "notation",
      categoryLabel: "Indicaciones de tejido",
      diagramSupported: false,
      description: "Línea que indica trabajar tomando las dos hebras del punto.",
      markup: '<path d="M9 24h30"/>'
    },
    {
      id: "repeat",
      name: "Grupo repetido",
      abbreviation: "rep.",
      category: "motifs",
      categoryLabel: "Motivos",
      diagramSupported: false,
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
