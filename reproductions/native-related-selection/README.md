# Native dependencies in related-test selection

This small commerce project exercises shipping providers, regional tax policies,
stock, and a catalog source alias. Its six tests pass before the verification
scripts deliberately change their inputs. The project contains no application
code or dependencies from a private repository.

There are two independently reviewable approaches:

- **Existing loader APIs:** explicitly list each importer's complete native input
  closure, then register those inputs with `addDependency`/`addMissingDependency`.
  The loader returns source unchanged. This needs a Rstest version with loader
  input selection support; it does not need the native metadata prototype.
- **Proposed native analysis:** record request descriptions in native
  `RstestPlugin`, then let Node resolve supported literal requests. Unproven
  computed paths and observed unsupported capabilities produce an explicit
  incomplete-analysis error unless complete dependencies have been declared.

This accompanies the design discussion in
[Rstest #2005](https://github.com/web-infra-dev/rstest/issues/2005). It does not
enable parser options to change native execution, add native candidates to the
compiler graph, or promise automatic inference of arbitrary JavaScript.

The draft implementations are:

- [Rstest consumer PR #2023](https://github.com/web-infra-dev/rstest/pull/2023),
  [commit 6d6c325](https://github.com/web-infra-dev/rstest/commit/6d6c3258403e6e011dade7c72a8b9a16be34ae86).
- [Rspack producer PR #16368](https://github.com/web-infra-dev/rspack/pull/16368),
  [commit 03765633](https://github.com/web-infra-dev/rspack/commit/037656338b9f5e89ab12c5ab68e947b279456b6c).

Check out those revisions before building the native prototype. The draft status
reflects the remaining design discussion and coverage-build validation.

The [fresh publication validation](evidence/PUBLICATION.md) records a separate
install/build on upstream base `4bd5684`, using published Rsbuild/Rspack 2.3.0
JavaScript packages and the proposed custom native binding. The historical
benchmark artifacts and their limitations remain unchanged.

## Run the reproductions

Use Node **22.21.1**, the version used for the recorded results. These scripts
have no dependencies of their own. Pass a built Rstest CLI; temporary fixtures
link their `@rstest/core` imports to exactly that selected runner. Build the
runner and its dependencies separately using the corresponding repository's
instructions. Do not run builds and these checks concurrently.

For the publication candidate, the consumer checkout's frozen lockfile selects
the published 2.3.0 JavaScript dependencies. No local Rspack JavaScript package
links are needed. After building the proposed native producer in its Rspack
checkout, install and build the consumer from its repository root:

```sh
pnpm install --frozen-lockfile
NAPI_RS_NATIVE_LIBRARY_PATH=/path/to/custom/rspack.darwin-arm64.node pnpm build
```

Use the actual absolute binding path and platform filename. Published Rspack
2.3.0 JavaScript is compatible with this tested binding, but the published native
binary does not contain the proposed metadata producer. The demo's `--binding`
argument sets `NAPI_RS_NATIVE_LIBRARY_PATH` for its child processes. Published
`@rspack/core` 2.3.0 also supports `RSPACK_BINDING` in both its main and worker
entrypoints. Use one binding override at a time.

For the existing-API path, pass an **unmodified upstream Rstest CLI** with loader
input selection support, rather than the experimental consumer checkout. From
this directory:

```sh
node scripts/verify.mjs \
  --cli /path/to/rstest/packages/core/bin/rstest.js \
  --mode api --output test-results/api
```

The native prototype requires both the proposed Rspack producer and Rstest
consumer. Supply the actual built native binding explicitly:

```sh
node scripts/verify.mjs \
  --cli /path/to/rstest/packages/core/bin/rstest.js \
  --binding /path/to/rspack/crates/node_binding/rspack.darwin-arm64.node \
  --mode native --output test-results/native
```

Use the native filename appropriate to your platform. Cross-platform behavior
was not established by the recorded macOS runs. The commands refuse to replace
an existing output directory. An unfixed implementation should fail applicable
assertions; the exit code is not suppressed.

The API command runs **33 strict checks**. Native mode runs those checks plus
**13 native integration checks, 34 final regression checks, and 9 deleted-path
checks**. Every selection assertion compares the complete expected file set:
extra and missing tests both fail. Runtime mutation controls prove that a changed
helper really breaks the selected consumer. The strict harness uses disposable
Git repositories; it does not change this repository's source or history.

The implementation's separate **48 core unit tests** are not duplicated here.
See [the evidence summary](evidence/RESULTS.md) for all validation scopes,
historical failures, and performance qualifications.

## What the application demonstrates

The [fixture](validation/fixture) has independent consumers for shipping,
CommonJS shipping, provider-location lookup, regional tax, stock, and the catalog.
Providers import policy helpers outside their own directories. Unused candidates
and the resolve-only target contain deliberately invalid JavaScript: selection
must not compile or execute them. Source aliases continue to use ordinary
configured resolution.

The [manifest](declarations/example-native-dependencies.json) maps four actual
importers to ten potential runtime inputs. It is not a table of expected test
names. The graph finds each importer's consuming tests. Both possible providers
can be inputs even when one test invocation selects only one at runtime.

The final regression fixtures also cover default `createRequire`, a CommonJS
`var require` redeclaration, Node loader-option spellings and option files, and
deleting a literal target beneath an existing directory symlink.

## Declaration contract

The project owner must keep declarations complete, including transitive native
helpers. An omitted input can cause under-selection; this example does not prove
manifest completeness. Adding or removing importer keys requires a compiler
restart. Input-list changes for existing importers can be reloaded per compilation.

`declarations/plugin.mjs` uses public loader APIs only.
`declarations/native-marker-plugin.mjs` additionally supplies the proposed
complete-declaration marker for the native consumer. That marker is a research
contract, not an already released Rstest configuration option.

The prototype deliberately diagnoses observed unsupported module-loading
capabilities, including benign imports of the Node module API. It does not
establish universal reflection/hook detection, browser or Rstest watch selection,
or Git's staged/committed deleted-path discovery. The symlink deletion check
supplies the physical path explicitly through `--related`.

## Reproduce scale measurements

Only generators and the measurement harness are included, not generated trees,
native binaries, or machine-specific logs. See [benchmark instructions](benchmarks/README.md).
Published evidence records the tested artifact fingerprints; the historical
uncommitted binary snapshots are not distributed in this example. Reviewers can
compare their own built revisions with the supplied scripts and correctness gates.
