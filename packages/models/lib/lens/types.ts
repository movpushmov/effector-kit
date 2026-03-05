import type {
  Event,
  EventCallable,
  Store,
  StoreValue,
  StoreWritable,
} from "effector";
import type { ContractData, Model, ModelApi, ModelApiElement } from "../models";

export type LensPredicate = (
  instances: Record<string | number, any>,
  props: any,
) => Record<string | number, any>;

type WatchableUnitActions<T> = {
  clock(): Event<T>;
};

type TargetableUnitActions<T, Props = never> = WatchableUnitActions<T> & {
  target: [Props] extends [never]
    ? () => EventCallable<T>
    : (map: (props: Props) => T) => EventCallable<Props>;
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

export type LensProps<InputModel extends Model<any, any>> = {
  props<T>(): Lens<InputModel, T>;
};

export type Lens<
  InputModel extends Model<any, any>,
  Props = never,
> = ModelLensApi<InputModel, Props> & {
  getSource(): StoreValue<InputModel["$instances"]>;
  where(
    predicate: [Props] extends [never]
      ? (data: ContractData<InputModel["~contract"]>) => boolean
      : (data: ContractData<InputModel["~contract"]>, props: Props) => boolean,
  ): Lens<InputModel, Props>;
  first(): Lens<InputModel, Props>;
  last(): Lens<InputModel, Props>;
};
