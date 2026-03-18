import type { HKT } from "../hkt";
import type { Model } from "../models";

export type GenericsMap = Record<string, any>;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export type GenericsHKT = HKT.BaseHKT<"~generics">;
export type TypeElementHKT = HKT.BaseHKT<"~typeElement">;

export type ExtractHKTType<Source extends StoreElement | EventElement> =
  HKT.GetParameter<Source, TypeElementHKT> extends infer Type extends
    TypeElement
    ? [Type] extends [StaticElement<infer U>]
      ? U
      : [Type] extends [GenericElement]
        ? HKT.GetParameter<Source, GenericsHKT> extends infer Map extends
            GenericsMap
          ? Map[NonNullable<Type["~name"]>]
          : never
        : never
    : never;

export interface StoreElement extends GenericsHKT, TypeElementHKT {
  "~kind": "store";
  defaultValue: this["~type"];
  "~type": ExtractHKTType<this>;
}

export interface EventElement extends GenericsHKT, TypeElementHKT {
  "~kind": "event";
  "~type": ExtractHKTType<this>;
}

export type ChildElement<T extends Model<any, any> = any> = {
  "~kind": "child";
  model: T;
};

export type RefElement<T extends Model<any, any> = any> = {
  "~kind": "ref";
  model: T;
};

export type GenericElement = { "~kind": "generic"; "~name"?: string };
export type StaticElement<T> = {
  "~kind": "static";
  "~static"?: T;
};

export type TypeElement = GenericElement | StaticElement<any>;
export type ExtractTypeFromElement<
  T extends TypeElement,
  Generic = never,
> = T extends GenericElement
  ? Generic
  : T extends StaticElement<infer U>
    ? U
    : never;

export type ShapeElement = StoreElement | EventElement;

export interface Shape {
  [k: string]: ShapeElement;
}

export type ExtractGenericsFromShape<T extends Shape> = UnionToIntersection<
  {
    [k in keyof T]: [HKT.GetParameter<T[k], TypeElementHKT>] extends [
      StaticElement<any>,
    ]
      ? never
      : [HKT.GetParameter<T[k], TypeElementHKT>] extends [never]
        ? never
        : HKT.GetParameter<T[k], TypeElementHKT> extends GenericElement
          ? {
              [name in NonNullable<
                HKT.GetParameter<T[k], TypeElementHKT>["~name"]
              >]: unknown;
            }
          : never;
  }[keyof T]
>;

export interface Contract<
  T extends Shape,
  Generics extends ExtractGenericsFromShape<T> = ExtractGenericsFromShape<T>,
> {
  "~kind": "contract";
  shape: {
    [k in keyof T]: HKT.WithParameter<T[k], GenericsHKT, Generics>;
  };
}
