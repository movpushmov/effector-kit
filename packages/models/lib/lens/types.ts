import type {
  Event,
  EventCallable,
  Store,
  StoreValue,
  StoreWritable,
} from 'effector';
import type { Contract } from '../contracts';
import type {
  AddAliasPayload,
  ContractData,
  Model,
  ModelApi,
  ModelApiElement,
} from '../models';
import type { Union, UnionMap } from '../union';

export type LensPredicate = (
  instances: Record<string | number, any>,
  props: any,
) => Record<string | number, any>;

export interface SingleResultLensMarker {
  readonly '~single': true;
}

type WatchableUnitActions<T> = {
  clock(): Event<T>;
};

type TargetableUnitActions<T, Props = never> = WatchableUnitActions<T> & {
  target: (
    map?: (props: Props) => T,
  ) => EventCallable<[Props] extends [never] ? T : Props>;
};

type ModelLensElement<Element extends ModelApiElement, Props = never> =
  Element extends StoreWritable<infer Value>
    ? TargetableUnitActions<Value, Props>
    : Element extends Store<infer Value>
      ? WatchableUnitActions<Value>
      : Element extends EventCallable<infer Payload>
        ? TargetableUnitActions<Payload, Props>
        : Element extends Event<infer Payload>
          ? WatchableUnitActions<Payload>
          : Element extends Model<any, any>
            ? Lens<Element, Props>
            : Element extends ModelApi
              ? NestedModelLensApi<Element, Props>
              : never;

type NestedModelLensApi<Api extends ModelApi, Props> = {
  [K in keyof Api]: ModelLensElement<Api[K], Props>;
};

export type LensInputModel<
  TContract extends Contract<any> = Contract<any>,
  TApi extends Record<string, ModelApiElement> = Record<
    string,
    ModelApiElement
  >,
  TInstances = Record<string, unknown>,
> = {
  '~kind': 'model';
  '~contract': TContract;
  '~api': TApi;
  $instances: Store<TInstances>;
};

export type ModelLensApi<InputModel extends LensInputModel, Props> = {
  [k in keyof InputModel['~api']]: ModelLensElement<
    InputModel['~api'][k],
    Props
  >;
};

export type LensProps<InputModel extends LensInputModel | Union<UnionMap>> = {
  props<T>(): Lens<InputModel, T>;
};

type LensApi<
  Input extends LensInputModel,
  Props = never,
  Single extends boolean = false,
> = {
  getSource(): StoreValue<Input['$instances']>;
  ids(...ids: string[]): Lens<Input, Props, Single>;
  where(
    predicate: [Props] extends [never]
      ? (data: ContractData<Input['~contract']> & { id: string }) => boolean
      : (
          data: ContractData<Input['~contract']> & { id: string },
          props: Props,
        ) => boolean,
  ): Lens<Input, Props, Single>;
  first(): SingleLens<Input, Props>;
  last(): SingleLens<Input, Props>;
  single(): SingleLens<Input, Props>;
  delete(): EventCallable<void>;
  addAlias(): EventCallable<AddAliasPayload>;
};

// ---- Union lens types ----

/** Tagged union of all contract data across the active keys, each annotated with its model key. */
type UnionEntityData<
  U extends Union<UnionMap>,
  Keys extends keyof U['models'] = keyof U['models'],
> = {
  [K in Keys]: ContractData<U['models'][K]['~contract']> & {
    id: string;
    '~model': K;
  };
}[Keys];

type UnionMatchConfig<
  U extends Union<UnionMap>,
  Keys extends keyof U['models'],
  Props,
> = Partial<{
  [VariantKey in Keys]: (
    subLens: Lens<U['models'][VariantKey], Props>,
  ) => Event<any> | EventCallable<any>;
}>;

type UnionMatchPayload<Config> = {
  [HandlerKey in keyof Config]: Config[HandlerKey] extends (
    ...args: any[]
  ) => Event<infer Payload> | EventCallable<infer Payload>
    ? Payload
    : never;
}[keyof Config];

type UnionVariantApi<
  U extends Union<UnionMap>,
  Keys extends keyof U['models'],
  Props,
> = {
  [VariantKey in Keys]: ModelLensApi<U['models'][VariantKey], Props>;
};

/**
 * Lens over a union of models.
 *
 * - `only(...keys)` – narrows to a subset of variants; only those keys'
 *   model APIs are accessible on the resulting lens.
 * - `where(predicate)` – filters instances by tagged union entity.
 * - `[K in Keys]` – direct access to each active variant's model API,
 *   e.g. `lens.a.increment.target()` dispatches only to filtered modelA
 *   instances.
 * - `match(config)` – per-variant sub-lens dispatch; each handler receives
 *   a `SubLens` pre-scoped to that variant, with optional extra `where()`
 *   filtering, and returns an EventCallable for that variant's instances.
 */
export type UnionLens<
  U extends Union<UnionMap>,
  Keys extends keyof U['models'] = keyof U['models'],
  Props = never,
  Single extends boolean = false,
> = {
  only<K extends Keys>(...keys: K[]): UnionLens<U, K, Props, Single>;
  ids(...ids: string[]): UnionLens<U, Keys, Props, Single>;
  where(
    predicate: [Props] extends [never]
      ? (
          entity: UnionEntityData<U, Keys>,
          _?: undefined,
          ctx?: {
            match(config: Partial<Record<Keys, (data: any) => any>>): any;
            uniqueId<K extends Keys>(variantKey: K, id: string): string;
          },
        ) => boolean
      : (
          entity: UnionEntityData<U, Keys>,
          props: Props,
          ctx: {
            match(config: Partial<Record<Keys, (data: any) => any>>): any;
            uniqueId<K extends Keys>(variantKey: K, id: string): string;
          },
        ) => boolean,
  ): UnionLens<U, Keys, Props, Single>;
  first(): SingleLens<U, Props>;
  last(): SingleLens<U, Props>;
  single(): SingleLens<U, Props>;
  delete(): EventCallable<void>;
  uniqueId<K extends Keys>(variantKey: K, id: string): string;
  match<Config extends UnionMatchConfig<U, Keys, Props>>(
    config: Config,
  ): EventCallable<UnionMatchPayload<Config>>;
} & UnionVariantApi<U, Keys, Props> &
  (Single extends true ? SingleResultLensMarker : {});

export type SingleLens<
  Input extends LensInputModel | Union<UnionMap>,
  Props = never,
> = Lens<Input, Props, true>;

export type Lens<
  Input extends LensInputModel | Union<UnionMap>,
  Props = never,
  Single extends boolean = false,
> = Input extends LensInputModel
  ? ModelLensApi<Input, Props> &
      LensApi<Input, Props, Single> &
      (Single extends true ? SingleResultLensMarker : {})
  : Input extends Union<UnionMap>
    ? UnionLens<Input, keyof Input['models'], Props, Single>
    : never;
