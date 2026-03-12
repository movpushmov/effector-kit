export namespace HKT {
  export type ExtractId<T extends BaseHKT<any>> =
    T extends BaseHKT<infer U> ? U : never;

  export type GetParameter<
    T extends object,
    Target extends BaseHKT<any>,
  > = T[ExtractId<Target>]["~parameter"];

  export type WithParameter<
    T extends object,
    Target extends BaseHKT<any>,
    Parameter,
  > = T & {
    [k in ExtractId<Target>]: {
      "~parameter": Parameter;
    };
  };

  export type BaseHKT<Id extends string> = {
    [K in Id]: {
      "~parameter": unknown;
    };
  };
}
