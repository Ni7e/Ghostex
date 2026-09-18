/**
 * Project a reorder of the VISIBLE Space buttons back onto the full order. The
 * visible buttons occupy a set of positions in the stored order (promotion can
 * make that set non-contiguous), so the reordered visible ids are written back
 * into exactly those positions and every overflowed Space keeps its slot.
 */
export function applySidebarSpaceRowReorder(
  orderedSpaceIds: readonly string[],
  visibleSpaceIds: readonly string[],
  reorderedVisibleSpaceIds: readonly string[]
): string[] {
  const visibleSpaceIdSet = new Set(visibleSpaceIds);
  const nextOrder = [...orderedSpaceIds];
  let visibleIndex = 0;
  for (const [index, spaceId] of nextOrder.entries()) {
    if (!visibleSpaceIdSet.has(spaceId)) {
      continue;
    }
    const nextSpaceId = reorderedVisibleSpaceIds[visibleIndex];
    visibleIndex += 1;
    if (nextSpaceId) {
      nextOrder[index] = nextSpaceId;
    }
  }
  return nextOrder;
}
