# Vue + Scope (Effector)

## 1. Integration Defaults

- Use modern `effector-vue` APIs.
- Keep UI components thin; model logic remains in Effector domain modules.

## 2. Scope and SSR

- For SSR/isolation flows, ensure per-request scope strategy.
- Keep state transfer explicit and deterministic.

## 3. Canonical SSR Wiring

Use modern `effector-vue` integration and avoid deprecated `effector-vue/ssr` APIs.

```ts
// entry-server.ts
import { createSSRApp } from 'vue';
import { fork, allSettled, serialize } from 'effector';
import { EffectorScopePlugin } from 'effector-vue';

export async function renderPage(AppComponent: any, appStarted: any) {
  const scope = fork();
  await allSettled(appStarted, { scope });

  const app = createSSRApp(AppComponent);
  app.use(EffectorScopePlugin({ scope, scopeName: 'root' }));

  const values = serialize(scope);
  return { app, values };
}
```

```ts
// entry-client.ts
import { createApp } from 'vue';
import { fork } from 'effector';
import { EffectorScopePlugin } from 'effector-vue';
import AppComponent from './App.vue';

const scope = fork({
  values: (window as any).__INITIAL_STATE__,
});

const app = createApp(AppComponent);
app.use(EffectorScopePlugin({ scope, scopeName: 'root' }));
app.mount('#app');
```

## 4. Composition Pattern

```ts
import { useUnit } from 'effector-vue/composition';

export default {
  setup() {
    const [count, increment] = useUnit([$count, incrementClicked]);
    return { count, increment };
  },
};
```

## 5. Migration Notes

- Treat older SSR plugin wiring as legacy when modern equivalents are available.
- Migrate module-by-module with parity checks.
