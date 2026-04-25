import type { EventCallable, StoreWritable } from 'effector';
import type { Lens, LensProps } from '../lens';
import type { Model } from '../models';
import type { Union, UnionMap } from '../union';

type RefOps<T extends Model<any, any> | Union<UnionMap>> =
  T extends Union<UnionMap>
    ? {
        add: { [K in keyof T['models']]: EventCallable<string> };
        remove: { [K in keyof T['models']]: EventCallable<string> };
        $ids: StoreWritable<Array<{ key: string; id: string }>>;
      }
    : {
        add: EventCallable<string>;
        remove: EventCallable<string>;
        $ids: StoreWritable<string[]>;
      };

export type Ref<T extends Model<any, any> | Union<UnionMap>> = {
  '~kind': 'ref';
  '~id': string;
  '~target': T;
  lens: Lens<T> & LensProps<T>;
} & RefOps<T>;
