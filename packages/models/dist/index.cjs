let effector = require("effector");
let effector_action = require("effector-action");

//#region lib/define.ts
const define = {
	store(_, defaultValue) {
		return {
			"~type": "store",
			defaultValue
		};
	},
	event(_) {
		return { "~type": "event" };
	},
	child(model) {
		return {
			"~type": "child",
			model
		};
	},
	ref(model) {
		return {
			"~type": "ref",
			model
		};
	},
	generic() {
		return { "~type": "generic" };
	},
	static() {
		return { "~type": "static" };
	}
};

//#endregion
//#region lib/runtime/context.ts
let runtimeContext = {};
function getContext() {
	return runtimeContext;
}
function setContext(ctx) {
	runtimeContext = ctx;
}

//#endregion
//#region lib/runtime/inspector.ts
function getRuntimeContext(stack) {
	const currentContext = getContext();
	stack["~modelsRuntimeCtx"] = currentContext;
	return currentContext;
}
function primeStoreScopes(context, scopeReg) {
	const { model, instance } = context.current;
	const api = model["~api"];
	for (const key in api) {
		const apiElement = api[key];
		if (!effector.is.store(apiElement)) continue;
		const rootId = apiElement.graphite.meta.rootStateRefId;
		const instanceValue = instance[key] ?? null;
		if (!scopeReg[rootId]) {
			const stateRef = apiElement.graphite.meta.stateRef;
			scopeReg[rootId] = Object.assign({}, stateRef, { current: instanceValue });
		} else scopeReg[rootId].current = instanceValue;
	}
}
function modifyRegion(node) {
	for (const link of node.family.links) {
		if (link["~reserved"]) continue;
		link.seq.unshift(effector.step.compute({
			fn: (data, scope, stack) => {
				const context = getRuntimeContext(stack);
				if (!context.current) throw new Error("Panic: Cannot call model unit without instance runtime context");
				context.current.scope = stack.scope;
				setContext(context);
				if (stack.scope) {
					const scopeReg = stack.scope.reg;
					primeStoreScopes(context, scopeReg);
				}
				return data;
			},
			safe: true
		}));
	}
}
let region = null;
function modifyDeclarations(fn) {
	if (region) return {
		result: fn(),
		region
	};
	region = (0, effector.createNode)({ regional: true });
	const result = {
		result: (0, effector.withRegion)(region, fn),
		region
	};
	modifyRegion(region);
	region = null;
	return result;
}

//#endregion
//#region lib/runtime/api.ts
function modifyStore($store, key) {
	Object.defineProperty($store.graphite.meta.stateRef, "current", { get() {
		const ctx = getContext();
		if (!ctx.current) return null;
		return ctx.current.instance[key];
	} });
	(0, effector_action.createAction)({
		clock: $store,
		target: {},
		fn: (_, value) => {
			const ctx = getContext();
			if (!ctx.current) return;
			if (ctx.current.scope) ctx.current.scope.reg[$store.graphite.meta.rootStateRefId].current = value;
			ctx.current.instance[key] = value;
		}
	});
}
function modifyRefsStore(model, $store) {
	reserve([$store]);
	Object.defineProperty($store.graphite.meta.stateRef, "current", { get() {
		const ctx = getContext();
		if (!ctx.current) return null;
		const instance = ctx.current.instance;
		if (!instance["~refs"]) instance["~refs"] = {};
		return instance["~refs"][model["~id"]] ?? [];
	} });
	(0, effector_action.createAction)({
		clock: $store,
		target: {},
		fn: (_, value) => {
			const ctx = getContext();
			if (!ctx.current) return;
			if (ctx.current.scope) ctx.current.scope.reg[$store.graphite.meta.rootStateRefId].current = value;
			if (!ctx.current.instance["~refs"]) ctx.current.instance["~refs"] = {};
			ctx.current.instance["~refs"][model["~id"]] = [...ctx.current.instance["~refs"][model["~id"]], value];
		}
	});
}
function modifyChildStore(model, $store) {
	reserve([$store]);
	Object.defineProperty($store.graphite.meta.stateRef, "current", { get() {
		const ctx = getContext();
		if (!ctx.current) return null;
		const instance = ctx.current.instance;
		if (!instance["~children"]) instance["~children"] = {};
		return instance["~children"][model["~id"]] ?? {};
	} });
	(0, effector_action.createAction)({
		clock: $store,
		target: {},
		fn: (_, value) => {
			const ctx = getContext();
			if (!ctx.current) return;
			if (ctx.current.scope) ctx.current.scope.reg[$store.graphite.meta.rootStateRefId].current = value;
			if (!ctx.current.instance["~children"]) ctx.current.instance["~children"] = {};
			ctx.current.instance["~children"][model["~id"]] = value;
		}
	});
}
function reserve(units) {
	for (const unit of units) Object.defineProperty(unit, "~reserved", { value: true });
}

//#endregion
//#region lib/models/create-api.ts
function transform(from, to) {
	for (const key in from) {
		const item = from[key];
		if (!item) throw new Error("Invalid item type: undefined");
		switch (item?.["~type"]) {
			case "store":
				to[key] = (0, effector.createStore)(item.defaultValue, { serialize: "ignore" });
				modifyStore(to[key], key);
				break;
			case "event":
				to[key] = (0, effector.createEvent)();
				break;
		}
	}
}
function createApi(contract) {
	const api = {};
	transform(contract.shape, api);
	return api;
}

//#endregion
//#region lib/lens/lens.ts
const basePredicates = {
	where: (fn) => (instances, props) => {
		const newInstances = {};
		for (const key in instances) {
			const instance = instances[key];
			if (fn({
				id: key,
				...instance
			}, props)) newInstances[key] = instance;
		}
		return newInstances;
	},
	first: (instances) => {
		const entry = Object.entries(instances)[0];
		if (entry) return { [entry[0]]: entry[1] };
		return {};
	},
	last: (instances) => {
		const entry = Object.entries(instances).at(-1);
		if (entry) return { [entry[0]]: entry[1] };
		return {};
	}
};
function findInstance(instances, instance) {
	return Object.values(instances).find((value) => value === instance);
}
function applyTransformers(instances, predicates, payload) {
	let buffer = instances;
	for (const predicate of predicates) buffer = predicate(buffer, payload);
	return buffer;
}
function getRuntimeInfo(model, predicates, payload) {
	return {
		ctx: getContext(),
		instances: applyTransformers(model.$instances.getState(), predicates, payload)
	};
}
function exportModelApi(model, getPredicates) {
	const lensApi = {};
	for (const key in model["~api"]) {
		const element = model["~api"][key];
		if (!element) continue;
		if (effector.is.store(element) || effector.is.event(element)) {
			const unitElement = { clock() {
				const clock = (0, effector.createEvent)();
				(0, effector.sample)({
					clock: element,
					filter: (payload) => {
						const { ctx, instances } = getRuntimeInfo(model, getPredicates(), payload);
						if (!ctx.current) return false;
						return Boolean(ctx.current) && ctx.current.model === model && Object.keys(instances).length > 0 && findInstance(instances, ctx.current.instance);
					},
					target: clock
				});
				return clock;
			} };
			if (effector.is.targetable(element)) Object.defineProperty(unitElement, "target", { value: (map) => {
				const target = (0, effector.createEvent)();
				const actionFx = (0, effector.createEffect)(async (payload) => {
					const { instances } = getRuntimeInfo(model, getPredicates(), payload);
					if (Object.keys(instances).length === 0) return Promise.reject();
					let capturedScope = void 0;
					const storeRootId = effector.is.store(element) ? element.graphite.meta.rootStateRefId : null;
					for (const instance of Object.values(instances)) {
						setContext({ current: {
							model,
							instance
						} });
						if (capturedScope && storeRootId) {
							const stateRef = capturedScope.reg[storeRootId];
							if (stateRef) stateRef.current = void 0;
						}
						(0, effector.launch)(element, payload);
						if (!capturedScope) capturedScope = getContext().current?.scope;
					}
				});
				(0, effector.sample)({
					clock: map !== void 0 ? target.map(map) : target,
					target: actionFx
				});
				return target;
			} });
			lensApi[key] = unitElement;
		}
		if (isModel(element)) lensApi[key] = element.lens;
	}
	return lensApi;
}
function lens(model) {
	let predicates = [];
	return {
		getSource() {
			return model.$instances.getState();
		},
		props() {
			return this;
		},
		where(predicate) {
			predicates.push(basePredicates.where(predicate));
			return this;
		},
		first() {
			predicates.push(basePredicates.first);
			return this;
		},
		last() {
			predicates.push(basePredicates.last);
			return this;
		},
		...exportModelApi(model, () => predicates)
	};
}

//#endregion
//#region lib/models/models.ts
function model({ contract, fn, instances }) {
	const sid = Math.random().toString(36).slice(2);
	const $instances = instances ?? (0, effector.createStore)({}, { sid: `$instances/${sid}` });
	const create = (0, effector.createEvent)();
	const { result: modelApi } = modifyDeclarations(() => {
		return fn(createApi(contract));
	});
	(0, effector.sample)({
		clock: create,
		source: $instances,
		fn: (instances, { id, data }) => ({
			...instances,
			[id]: { ...data }
		}),
		target: $instances
	});
	const builtModel = {
		"~type": "model",
		"~contract": contract,
		"~api": modelApi,
		"~fn": fn,
		"~id": Math.random().toString(),
		$instances,
		create
	};
	return Object.assign(builtModel, { lens: lens(builtModel) });
}

//#endregion
//#region lib/models/utils.ts
function isModel(value) {
	return typeof value === "object" && value !== null && "~type" in value && value["~type"] === "model";
}

//#endregion
//#region lib/contracts/contracts.ts
function contract(shape) {
	return () => ({
		"~type": "contract",
		shape
	});
}

//#endregion
//#region lib/ref/ref.ts
function ref(model) {
	const $ids = (0, effector.createStore)([]);
	modifyRefsStore(model, $ids);
	const add = (0, effector.createEvent)();
	const remove = (0, effector.createEvent)();
	(0, effector.sample)({
		clock: add,
		source: $ids,
		fn: (ids, id) => [...ids, id],
		target: $ids
	});
	(0, effector.sample)({
		clock: remove,
		source: $ids,
		fn: (ids, id) => ids.filter((i) => i !== id),
		target: $ids
	});
	const patchedLens = lens(model);
	Object.defineProperty(patchedLens, "getSource", { value: () => {
		const ids = $ids.getState();
		if (!ids) return {};
		const instances = model.$instances.getState();
		return Object.fromEntries(Object.entries(instances).filter(([key]) => ids.includes(key)));
	} });
	return {
		"~type": "ref",
		lens: patchedLens
	};
}

//#endregion
//#region lib/child/child.ts
function child(inputModel) {
	const $instances = (0, effector.createStore)({});
	modifyChildStore(inputModel, $instances);
	return model({
		instances: $instances,
		fn: inputModel["~fn"],
		contract: inputModel["~contract"]
	});
}

//#endregion
exports.child = child;
exports.contract = contract;
exports.define = define;
exports.model = model;
exports.ref = ref;