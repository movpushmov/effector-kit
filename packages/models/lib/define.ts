import type {
  ChildElement,
  EventElement,
  RefElement,
  StoreElement,
} from './contracts';
import type { Model } from './models';
import type { Static, TSchema } from './type-schema';

export const define = {
  store<T extends TSchema>(_schema: T, storeValue: Static<T>): StoreElement<T> {
    // @ts-expect-error
    return { '~kind': 'store', defaultValue: storeValue };
  },

  event<T extends TSchema>(_schema: T): EventElement<T> {
    // @ts-expect-error
    return { '~kind': 'event' };
  },

  child<T extends Model<any, any>>(model: T): ChildElement<T> {
    return { '~kind': 'child', model };
  },

  ref<T extends Model<any, any>>(model: T): RefElement<T> {
    return { '~kind': 'ref', model };
  },

  schema<T extends TSchema>(): T {
    return null as any;
  },
};
