import type {
  Event,
  EventCallable,
  Store,
  StoreValue,
  StoreWritable,
} from "effector";
import type { ContractData, Model, ModelApiElement } from "../models";
import type { Union, UnionMap } from "../union";

export type LensPredicate = (
  instances: Record<string | number, any>,
  props: any,
) => Record<string | number, any>;

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
            : never;

export type ModelLensApi<InputModel extends Model<any, any>, Props> = {
  [k in keyof InputModel["~api"]]: ModelLensElement<
    InputModel["~api"][k],
    Props
  >;
};

export type LensProps<InputModel extends Model<any, any> | Union<UnionMap>> = {
  props<T>(): Lens<InputModel, T>;
};

type LensApi<Input extends Model<any, any>, Props = never> = {
  getSource(): StoreValue<Input["$instances"]>;
  where(
    predicate: [Props] extends [never]
      ? (data: ContractData<Input["~contract"]> & { id: string }) => boolean
      : (
          data: ContractData<Input["~contract"]> & { id: string },
          props: Props,
        ) => boolean,
  ): Lens<Input, Props>;
  first(): Lens<Input, Props>;
  last(): Lens<Input, Props>;
  delete(): EventCallable<void>;
};

// ---- Union lens types ----

/** Tagged union of all contract data across the active keys, each annotated with its model key. */
type UnionEntityData<
  U extends Union<UnionMap>,
  Keys extends keyof U["models"] = keyof U["models"],
> = {
  [K in Keys]: ContractData<U["models"][K]["~contract"]> & {
    id: string;
    "~model": K;
  };
}[Keys];

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
  Keys extends keyof U["models"] = keyof U["models"],
  Props = never,
> = {
  only<K extends Keys>(...keys: K[]): UnionLens<U, K, Props>;
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
  ): UnionLens<U, Keys, Props>;
  first(): UnionLens<U, Keys, Props>;
  last(): UnionLens<U, Keys, Props>;
  delete(): EventCallable<void>;
  uniqueId<K extends Keys>(variantKey: K, id: string): string;
  match<
    Config extends {
      [K in Keys]?: (
        subLens: Lens<U["models"][K], Props>,
      ) => Event<any> | EventCallable<any>;
    },
  >(
    config: Config,
  ): EventCallable<
    {
      [K in keyof Config]: Config[K] extends (
        ...args: any[]
      ) => Event<infer V> | EventCallable<infer V>
        ? V
        : never;
    }[keyof Config]
  >;
} & {
  [K in Keys]: ModelLensApi<U["models"][K], Props>;
};

export type Lens<
  Input extends Model<any, any> | Union<UnionMap>,
  Props = never,
> =
  Input extends Model<any, any>
    ? ModelLensApi<Input, Props> & LensApi<Input, Props>
    : Input extends Union<UnionMap>
      ? UnionLens<Input, keyof Input["models"], Props>
      : never;
