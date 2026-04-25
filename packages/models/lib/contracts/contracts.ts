import type { Contract, ExtractGenericsFromShape, Shape } from './types';

export function contract<T extends Shape>(
  shape: T,
): <K extends ExtractGenericsFromShape<T>>() => Contract<T, K> {
  const contract = {
    '~kind': 'contract',
    shape,
    withGeneric() {
      return contract;
    },
  };

  // @ts-expect-error
  return () => contract;
}
