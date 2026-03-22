import { createEvent } from "effector";
import type { Model } from "../models";

const storeChanged = createEvent<{
  id: string;
  model: Model<any, any>;
  data: any;
}>();

function watchChanges(model: Model<any, any>, id: string) {
  const changes = [];
  const unsubscribe = model.on((state) => {
    changes.push(state);
  });
  return () => {
    unsubscribe();
  };
}
