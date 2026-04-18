import type { Scope, StoreWritable } from "effector";
import type { Model } from "../models";

type DispatcherBaseEvent<Type extends string> = {
  "~kind": Type;
  payload: any;
};

export type DispatcherStoreChangedEvent = DispatcherBaseEvent<"store_changed">;
export type DispatcherEventCalledEvent = DispatcherBaseEvent<"event_called">;

export type DispatcherEvent =
  | DispatcherStoreChangedEvent
  | DispatcherEventCalledEvent;

interface RuntimeContextInfo {
  model: Model<any, any>;
  target?: Model<any, any>;
  instance: any;
  owner?: RuntimeContextInfo;
  scope?: Scope | undefined;
}

export interface RuntimeContext {
  current?: RuntimeContextInfo;
}
