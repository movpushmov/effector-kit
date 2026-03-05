# Solid + Scope (Effector)

## 1. Integration Defaults

- Use `effector-solid` modern exports by default.
- Use `useUnit` to read stores and bind callable units.
- Keep model logic in Effector modules, not Solid components.

## 2. Scope Usage

- Use `Provider` with a forked scope for isolation-sensitive flows.
- For SSR or isolated tests, create explicit `fork()` scope per run.

## 3. Canonical SSR Wiring

Server/client entrypoints should consistently use modern `effector-solid` exports.

```tsx
// entry-client.tsx
import { render } from 'solid-js/web';
import { fork } from 'effector';
import { Provider } from 'effector-solid';
import { App } from './App';

const scope = fork({
  values: (window as any).__INITIAL_STATE__,
});

render(
  () => (
    <Provider value={scope}>
      <App />
    </Provider>
  ),
  document.getElementById('root')!,
);
```

```ts
// entry-server.ts
import { fork, allSettled, serialize } from 'effector';
import { renderToString } from 'solid-js/web';
import { Provider } from 'effector-solid';

export async function renderPage(appStarted: any) {
  const scope = fork();
  await allSettled(appStarted, { scope });
  const html = renderToString(() => (
    <Provider value={scope}>
      <App />
    </Provider>
  ));
  const values = serialize(scope);
  return { html, values };
}
```

## 4. Component Pattern

```tsx
import { useUnit } from 'effector-solid';

const Counter = () => {
  const [count, increment] = useUnit([$count, incrementClicked]);
  return <button onClick={increment}>{count()}</button>;
};
```

## 5. Migration Notes

- Treat `effector-solid/scope` style as legacy.
- Avoid mixing old/new scope providers in the same migration window.
- Complete migration consistently across the app slice.
