import type { Model } from '../models';
import type { Union, UnionMap } from '../union';
import type { Lens, LensProps, UnionLens } from './types';
import { createLensRoot } from './builder';

export function lens<T extends Union<UnionMap>>(
  input: T,
): UnionLens<T, keyof T['models']> & LensProps<T>;
export function lens<T extends Model<any, any>>(
  model: T,
): Lens<T> & LensProps<T>;
export function lens(input: Union<UnionMap> | Model<any, any>): any {
  return createLensRoot(input);
}
