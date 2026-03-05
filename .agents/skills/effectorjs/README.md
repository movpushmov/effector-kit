# effectorjs

Quick-start documentation for the `effectorjs` skill.

## Purpose

Use this skill to design, refactor, and review Effector state management with modern v23+ defaults.

## Main Files

- `SKILL.md` - trigger and workflow instructions for the agent
- `references/core-patterns.md` - core modeling and wiring patterns
- `references/explicit-start.md` - explicit startup patterns for SPA/SSR/tests
- `references/computation-priority.md` - execution priority model and side-effect placement rules
- `references/react-ssr-scope.md` - React + SSR + scope guidance
- `references/solid-scope.md` - Solid + scope guidance
- `references/vue-scope.md` - Vue + scope guidance
- `references/anti-patterns-and-fixes.md` - common mistakes and refactors
- `references/legacy-migration-map.md` - migration from legacy patterns
- `references/checklists.md` - acceptance and review checklists

## Expected Outputs from the Skill

- Model topology (stores/events/effects)
- Declarative wiring snippets (`sample`, `attach`, `split`)
- Startup and scope lifecycle notes for SPA/SSR/tests when required
- Test scenarios and acceptance checks

## Typical Requests

- Build a new Effector model for a feature.
- Refactor imperative or brittle model logic.
- Make SSR flow scope-safe.
- Migrate legacy Effector patterns to modern v23+.
- Perform a risk-focused Effector code review.
