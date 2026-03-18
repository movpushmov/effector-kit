import { Model, Contract } from "@effector-kit/models";

export type ReactModel<T extends Model<Contract, any>> = {
  [k in keyof T["~contract"][""]];
};
