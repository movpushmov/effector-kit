# Changesets Workflow

Current release targets:

- `@effector-kit/models`
- `@effector-kit/react`

Packages excluded for now:

- `@effector-kit/forms`
- `@effector-kit/inspector`

Useful commands from the repo root:

- `pnpm changeset` - create a release note and select packages to bump
- `pnpm release:targets` - print the packages currently included in the release flow
- `pnpm release:verify` - run build and test for the configured release packages
- `pnpm release:status` - validate that changed releasable packages are covered by changesets
- `pnpm release:version` - apply pending changesets and refresh the lockfile
- `pnpm release:publish` - verify, then publish only the configured release packages to npm

Recommended release flow:

1. `pnpm changeset`
2. `pnpm release:verify`
3. `pnpm release:version`
4. Commit the versioned files
5. `pnpm release:publish`

Passing npm publish flags:

- `pnpm release:publish -- --tag next`
- `pnpm release:publish -- --otp 123456`

To expand the flow later:

1. Add the package name to `scripts/release/targets.json`
2. Remove the package from `.changeset/config.json.ignore`
3. Make sure the package has the scripts required by the release runner, usually `build` and `test`
