import { Event, EventCallable, is, Store, StoreWritable } from "effector";

export function readonly<T>(unit: StoreWritable<T>): Store<T>;
export function readonly<T>(unit: EventCallable<T>): Event<T>;
export function readonly(
  unit: StoreWritable<any> | EventCallable<any>,
): Store<any> | Event<any> {
  return unit.map((v) => v);
}
