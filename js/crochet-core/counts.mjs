export function calculateCounts(events, inputFrontier, outputFrontier, anchors, conventions) {
  const stitchesByType = { sc: 0, hdc: 0, dc: 0, tr: 0, sc2tog: 0, slip: 0 };
  let reuses = 0;
  let internalUses = 0;
  let chains = 0;
  let spaces = 0;
  let countedChains = 0;
  const consumed = new Set();
  for (const event of events) {
    for (const input of event.inputs) {
      if (input.role !== "target") continue;
      if (input.usage === "first") consumed.add(input.id);
      if (input.usage === "reuse") reuses++;
      if (input.usage === "internal_first" || input.usage === "internal_reuse") internalUses++;
    }
    if (Object.hasOwn(stitchesByType, event.type)) stitchesByType[event.type]++;
    if (event.type === "chain") {
      chains++;
      if (conventions.rowCountChainRoles.includes(event.produced[0].role)) countedChains++;
    }
    if (event.type === "space") spaces++;
  }
  const totalStitches = Object.values(stitchesByType).reduce((sum, count) => sum + count, 0);
  const rowCount = conventions.rowCountStitchTypes.reduce((sum, type) => sum + stitchesByType[type], countedChains);
  const exported = { stitch: 0, chain: 0, space: 0 };
  for (const id of outputFrontier) exported[anchors.get(id).kind]++;
  return {
    availableInputs: inputFrontier.length, consumedInputs: consumed.size, reuses, internalUses,
    stitchesByType, totalStitches, rowCount, chains, spaces, exported
  };
}
