import {
  createEvent,
  createStore,
  type EventCallable,
  type StoreWritable,
} from 'effector';
import type { Contract, ShapeElement } from '../contracts';
import type { ContractApi, ContractData } from './types';
import { modifyStore } from '../runtime';

interface TransformContext {
  key: string;
}

interface TransformApi {
  onStore: (defaultValue: any, ctx: TransformContext) => StoreWritable<any>;
  onEvent: () => EventCallable<any>;
}

function transform(
  from: Record<string, ShapeElement>,
  to: Record<string, any>,
  api: TransformApi,
) {
  for (const key in from) {
    const item = from[key];

    if (!item) {
      throw new Error('Invalid item type: undefined');
    }

    switch (item?.['~kind']) {
      case 'store': {
        to[key] = api.onStore(item.defaultValue, { key });
        Object.defineProperty(to[key], '~field', {
          value: key,
          configurable: true,
        });
        break;
      }
      case 'event': {
        to[key] = api.onEvent();
        Object.defineProperty(to[key], '~field', {
          value: key,
          configurable: true,
        });
        break;
      }
    }
  }
}

export function createApi<T extends Contract<any>>(
  contract: T,
): ContractApi<T> {
  const api = {} as ContractApi<T>;

  transform(contract.shape, api, {
    onStore: (defaultValue, { key }) => {
      const store = createStore(defaultValue, { serialize: 'ignore' });
      modifyStore(store, key);

      return store;
    },
    onEvent: () => createEvent(),
  });

  return api;
}

export function createStaticApi<T extends Contract<any>>(
  contract: T,
  data: ContractData<T>,
): ContractApi<T> {
  const api = {} as ContractApi<T>;

  transform(contract.shape, api, {
    onStore: (defaultValue, { key }) =>
      createStore(data[key as keyof ContractData<T>] ?? defaultValue),
    onEvent: () => createEvent(),
  });

  return api;
}
