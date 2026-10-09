export interface SequentialFocusTarget {
  tabIndex: number;
}

/** Mirrors browser sequential focus order for a DOM-ordered list of focusable controls. */
export function orderSequentialFocusTargets<T extends SequentialFocusTarget>(targets: readonly T[]): T[] {
  return targets
    .map((target, domOrder) => ({ target, domOrder }))
    .filter(({ target }) => Number.isInteger(target.tabIndex) && target.tabIndex >= 0)
    .sort((left, right) => {
      const leftBucket = left.target.tabIndex > 0 ? 0 : 1;
      const rightBucket = right.target.tabIndex > 0 ? 0 : 1;
      return leftBucket - rightBucket
        || (leftBucket === 0 ? left.target.tabIndex - right.target.tabIndex : 0)
        || left.domOrder - right.domOrder;
    })
    .map(({ target }) => target);
}
