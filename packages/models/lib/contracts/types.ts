import type { Model } from "../models";

export type GenericsMap = Record<string, any>;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export interface StoreElement {
  "~type": "store";
  defaultValue: this["~calculatedType"];

  "~generic": GenericElement;
  "~generics": GenericsMap;
  "~calculatedType": this["~generics"][NonNullable<this["~generic"]["~name"]>];
}

export interface EventElement {
  "~type": "event";
  "~generic": GenericElement;
  "~generics": GenericsMap;
  "~calculatedType": this["~generics"][NonNullable<this["~generic"]["~name"]>];
}

export type ChildElement<T extends Model<any, any> = any> = {
  "~type": "child";
  model: T;
};

export type RefElement<T extends Model<any, any> = any> = {
  "~type": "ref";
  model: T;
};

export type GenericElement = { "~type": "generic"; "~name"?: string };
export type StaticElement<T = any> = {
  "~type": "static";
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
    [k in keyof T]: [T[k]["~generic"]] extends [StaticElement<any>]
      ? never
      : [T[k]["~generic"]] extends [never]
        ? never
        : T[k]["~generic"] extends GenericElement
          ? { [name in NonNullable<T[k]["~generic"]["~name"]>]: unknown }
          : never;
  }[keyof T]
>;

export interface Contract<
  T extends Shape,
  Generics extends ExtractGenericsFromShape<T> = ExtractGenericsFromShape<T>,
> {
  "~type": "contract";
  shape: {
    [k in keyof T]: T[k] & { "~generics"?: Generics };
  };
}
