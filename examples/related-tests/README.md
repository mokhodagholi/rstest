# Related tests for a checkout service

This checkout service exercises affected-test selection using shipping providers,
generated receipts, a compiled product catalog, payment plugins, loyalty policies,
and stock reservations. Its application tests pass before the reproduction script
deliberately changes or deletes their inputs.

The example separates selector bugs from supported configuration and runtime
dependencies that cannot be inferred statically. See [the verification record](./VERIFICATION.md)
for the tested versions and results.

## Run the application and reproductions

From the Rstest repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @rstest/core build
pnpm --filter @examples/related-tests test
pnpm --filter @examples/related-tests reproduce --label prototype --output test-results/prototype
```

The application has 10 test files and 14 test cases. Its catalog is compiled with
TypeScript before testing. The reproduction command creates temporary Git
repositories, copies the application into them, and executes the real Rstest CLI.
It records selected files, exit codes, JSON test reports, and command output, then
deletes the temporary repositories. It does not change the original sources or
their Git history. Catalog build output and evidence under `test-results/` are ignored by Git.

To test an unmodified Rstest installation, pass its CLI as the positional argument:

```bash
pnpm --filter @examples/related-tests reproduce \
  /absolute/path/to/unmodified/node_modules/@rstest/core/bin/rstest.js \
  --label upstream-0.12.5 --output test-results/upstream
```

An independently built checkout also works: pass its
`packages/core/bin/rstest.js`. Each temporary application's `@rstest/core` import
is linked to the selected runner, so a baseline CLI cannot accidentally use the
prototype's test runtime. Both package metadata and the Node version are recorded
in `results.json`.

The script exits with code 1 if an expectation fails. That failure is intentional
when running an unfixed baseline. Checks have four categories:

- `regression`: expected correct selection or failure handling. These should fail
  before the relevant fix and pass afterward.
- `control`: existing behavior, including detecting deliberately broken code in a full run.
- `limitation`: an explicitly tested boundary, such as no automatic dependency
  edge for a runtime filesystem read. A passing limitation check means that the
  limitation was observed; it does not mean it was fixed.
- `observation`: captures available diagnostics for review. Success only means
  that the command ran; it does not assert that selection explanations exist.

## One pull request per bug

Use `--group` to run the reproduction relevant to a focused PR:

| PR                                                                                 | Group                               | Behavior under test                                                                                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Computed dependency selection](https://github.com/web-infra-dev/rstest/pull/2006) | `computed-imports`                  | Discoverable `import()`, `require()`, and `require.resolve()` contexts retain their dependency edges.                              |
| [Deleted-file selection](https://github.com/web-infra-dev/rstest/pull/2002)        | `deleted-files`                     | Staged and committed source/trigger deletions reach selection; a broken deleted import cannot pass as an empty run.                |
| [Loader dependency selection](https://github.com/web-infra-dev/rstest/pull/2004)   | `loader-inputs`, `compiled-mapping` | Standard file, directory, and missing dependencies participate in selection, including explicitly declared compiled-output inputs. |
| [Analysis failure handling](https://github.com/web-infra-dev/rstest/pull/2000)     | `analysis-errors`                   | An invalid dependency graph returns failure even when the requested source matches no test or only an otherwise valid test.        |

For example, from the repository root:

```bash
pnpm --filter @examples/related-tests reproduce \
  /absolute/path/to/unmodified/node_modules/@rstest/core/bin/rstest.js \
  --group loader-inputs --output test-results/loader-baseline

pnpm --filter @examples/related-tests reproduce \
  --group loader-inputs --output test-results/loader-prototype
```

The `integration` group checks a deleted member of a loader directory. It requires
both the deleted-file and loader fixes; it is separate from the individual PR
reproductions. `controls`, `runtime-inputs`, and `diagnostics` cover configuration
and design questions rather than additional confirmed bugs.

## Configuration comparisons

`CHECKOUT_DEMO_MODE` is an environment switch in this example's config, not a new
Rstest option. Each mode uses ordinary public configuration:

| Mode                | Configuration                                               | What the reproduction checks                                                                                           |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `default`           | Receipt loader rules and one declared rerun trigger         | Baseline execution and native selection.                                                                               |
| `parser-contexts`   | `tools.rspack.module.parser.javascript`                     | Enabling `importDynamic`, `requireDynamic`, and `requireResolve` alone does not fix the computed-context selector bug. |
| `bail`              | `tools.rspack.bail: true`                                   | This option alone does not make the invalid-analysis cases fail in the baseline.                                       |
| `source-alias`      | `resolve.alias`                                             | Selects the catalog price test and executes changed source even without rebuilding.                                    |
| `compiled-trigger`  | `forceRerunTriggers` for catalog source                     | Selects the whole suite; the application still executes the last built catalog until it is rebuilt.                    |
| `source-map-inputs` | A loader that calls `addDependency`                         | Preserves compiled-output execution while declaring precise source and build-config inputs.                            |
| `runtime-trigger`   | `forceRerunTriggers` for payment plugins and loyalty policy | Catches runtime input changes by selecting the full suite.                                                             |

### Compiled output and source aliases

The price test imports `packages/catalog/dist/price.js`, while Git tracks a change
to `packages/catalog/src/price.ts`. A source map beside the compiled JavaScript
does not, by itself, create a selection edge.

The [source-inputs loader](./source-inputs-loader.mjs) reads this example's
file-based TypeScript source maps and registers their inputs with `addDependency`.
Its options also declare the catalog's compiler configuration as an input. After
the loader-selection fix:

- A price-source change selects only the catalog price test.
- A compiler-config change selects both catalog tests, excluding unrelated tests.
- Tests still execute the compiled JavaScript. Rebuilding remains the caller's responsibility.

For this build, the existing loader API is sufficient; the evidence does not
justify inventing a separate mapping API. Other build systems may supply their
own source maps or dependency manifests. The example does not infer arbitrary
build relationships, handle every source-map format, or discover undeclared build inputs.

Source aliases serve a different purpose: they redirect execution to source. The
alias control deliberately changes source without rebuilding and observes a
failing price assertion. The mapping control makes the same change and observes
the old compiled behavior until the build is run.

### Runtime dependencies

The payment provider is loaded from a path chosen at runtime, and the loyalty
policy is read with `readFileSync`. Both can break a full run while a `--changed`
run without declared inputs selects no files. Explicit `forceRerunTriggers` catches these known
inputs, using a full-suite rerun.

This is evidence for documenting the boundary and discussing an optional
conservative selection policy. It is not evidence that Rstest can infer every
arbitrary runtime path, or that there is no existing configuration for known inputs.

### Selection explanations

The diagnostics group saves `list --json`, CLI help, and a `--trace` run with its
Perfetto and timing artifacts. In the audited version, the list identifies tests
and the trace reports performance; neither provides a source-to-test dependency
chain. A built-in explanation would be a separate feature proposal, not one of
the four correctness fixes.

## Boundaries

The control cases exercise source aliases, literal dynamic imports, named and
namespace imports through `export *` barrels, mocked consumers, and barrel
evaluation failures. They do not justify porting an additional barrel/mock
algorithm without a new failing reproduction.

Computed import coverage concerns statically discoverable directory contexts.
The CommonJS contract checks call computed `require` and `require.resolve` from
the test module; they do not claim support for every CommonJS execution pattern.
Deleted-file selection uses the current import graph and does not reconstruct
imports removed in earlier commits. Missing-path placeholders in the prototype
exist only during selection; actual test execution still sees the real filesystem.

These reproductions run in Node mode. They do not establish browser, watch-mode,
or cross-platform behavior, and they do not measure performance.
