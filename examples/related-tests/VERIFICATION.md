# Verification record

Verified on 2026-10-27 with Node.js 22.21.1 on macOS arm64.

- Baseline: unmodified `@rstest/core@0.12.5` from npm. Its installed `dist` matched
  the pristine package byte for byte. GitHub `main` was fetched and verified at
  [`8d799b8`](https://github.com/web-infra-dev/rstest/commit/8d799b8b7780547f0f4a30c2aea960ce1b805b3f),
  the `v0.12.5` release. No newer upstream commit was used or claimed.
- Prototype: core changes from
  [`199b2b8`](https://github.com/mokhodagholi/rstest/commit/199b2b8feb3d13db40bc6fbfaca02c3a33d4d190),
  rebuilt before testing, with the expanded example in this directory.
- Both runners executed the same fixtures and expectations. The unchanged
  application passed all 14 tests in 10 files on both.

The prototype contains the four fixes together. These results do not replace
testing each future PR independently after splitting its changes.

## Results

The reproduction command ran 57 checks for each runner:

| Category                                  | Checks | Released 0.12.5      | Prototype                 |
| ----------------------------------------- | -----: | -------------------- | ------------------------- |
| Correctness regressions                   |     26 | All 26 fail          | All 26 pass               |
| Supported behavior and execution controls |     24 | All pass             | All pass                  |
| Documented limitations                    |      4 | Limitations observed | Same limitations observed |
| Diagnostic commands                       |      3 | Commands succeed     | Commands succeed          |

The baseline reproduction exits 1 because the expected correct behavior is
missing. The prototype reproduction exits 0. This does not mean that every
design candidate has been implemented: the four limitation checks deliberately
verify behavior that remains unchanged.

| Reproduction group | Checks | Baseline failures | Prototype failures |
| ------------------ | -----: | ----------------: | -----------------: |
| `controls`         |      6 |                 0 |                  0 |
| `computed-imports` |      8 |                 7 |                  0 |
| `loader-inputs`    |      6 |                 4 |                  0 |
| `deleted-files`    |      6 |                 6 |                  0 |
| `analysis-errors`  |      6 |                 4 |                  0 |
| `compiled-mapping` |     12 |                 4 |                  0 |
| `runtime-inputs`   |      9 |                 0 |                  0 |
| `diagnostics`      |      3 |                 0 |                  0 |
| `integration`      |      1 |                 1 |                  0 |

The integration case combines a deleted path with a loader directory dependency.
It requires two fixes and is excluded from the individual bug groups.

## Confirmed bugs for separate PRs

1. **Computed dependency selection.** A discoverable shipping-provider import,
   CommonJS require, or require.resolve selects no files on the baseline. Explicit
   parser flags do not repair selection. Breaking a shipping provider fails a
   full run, while baseline `--changed --passWithNoTests` exits 0 without testing
   it. The prototype selects the checkout test and catches the failure.
2. **Deleted-file selection.** Both staged and committed deletions are missed.
   A deleted import can produce a successful empty run. A deleted configured
   rerun trigger does not rerun the suite. The prototype selects the importing
   test, fails its execution, and honors deleted triggers.
3. **Loader dependency selection.** The receipt loader declares file, directory,
   and missing dependencies with standard APIs. The baseline ignores them during
   selection, even though changing a footer breaks the full suite. The prototype
   selects the receipt test and preserves directory-prefix boundaries.
4. **Analysis failure handling.** With an invalid pricing module, requesting an
   unmatched source or only a valid catalog test can exit 0 despite a reported
   compilation error. `tools.rspack.bail` does not fix these baseline cases.
   The prototype returns exit 1. Ordinary full-suite compilation errors already
   fail on the baseline.

## Corrections to the broader feature claims

**Precise compiled-output relationships can use an existing API in this demo.**
The source-inputs loader registers TypeScript source-map inputs and the compiler
configuration through `addDependency`. Once the loader-selection bug is fixed:

- `packages/catalog/src/price.ts` selects only `tests/catalog-price.test.ts`.
- `packages/catalog/tsconfig.json` selects the two catalog tests, excluding the
  other eight test files.
- Changing source without rebuilding leaves compiled-output execution unchanged.
- Rebuilding after changing the coffee price from 1200 to 1300 makes the selected
  price test fail with an actual total of 2600 instead of the expected 2400.

This supports extending the loader PR with a mapping example. It does not yet
justify a separate mapping configuration API or automatic support for arbitrary
build systems. Source aliases already work and deliberately execute source.

**Known runtime inputs already have configuration.** A payment plugin selected
from a runtime URL and a loyalty policy read from the filesystem have no inferred
selection edges. `forceRerunTriggers` catches their changes by selecting the whole
suite. The same is true of compiled-source triggers, which do not rebuild output.
An optional conservative policy or clearer diagnostics remains a design proposal,
not a demonstrated absence of configuration for known inputs.

**Selection explanations remain a feature proposal.** The captured `list --json`
output identifies the selected file and test name. The `--trace` artifacts contain
phase, file, and test timing data. Neither supplies a dependency chain explaining
the selection. These observations concern the audited built-in interfaces; they
do not rule out writing a custom reporting plugin.

**The tested barrel/mock cases work natively.** Named and namespace imports,
`export *` barrels, mocked consumers, literal dynamic imports, and barrel
evaluation failures all passed the controls without the old custom algorithm.
This is not a claim that every possible barrel/mock pattern is covered.

## Evidence and scope

The commands in the [README](./README.md) write `results.json`, one command log per
check, JSON execution reports, and performance-trace artifacts to the selected
`test-results/` directory. The result records contain the exact expected and
observed file lists and exit codes. The compared runs used `test-results/upstream`
and `test-results/prototype`; their scenario IDs and expectations matched exactly.

Tests are limited to Node mode on the stated platform. No browser/watch behavior,
performance improvement, or isolated-PR validation is claimed by this record.
The four correctness fixes should be split and tested independently before
upstream PR publication.

Additional validation passed: all 24 tests in `e2e/filter/related.test.ts` after
removing the generated catalog output, the documented application test command,
repository lint/type checking, strict checking of the example config, `check-unused`,
and frozen offline lockfile validation. The e2e setup rebuilds the catalog, so
the example does not depend on previously generated output. The complete monorepo
test suite was not rerun for this demo change.
