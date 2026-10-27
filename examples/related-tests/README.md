# Related tests for a checkout service

This example models a small store checkout: integer-cent pricing, standard and express shipping, generated receipts, and stock reservations. It demonstrates how `--related` and `--changed` select affected tests when dependencies go beyond static imports.

Shipping providers are loaded through ``import(`./shipping/${shippingMethod}.mjs`)``. The receipt loader combines an order template with a footer, a directory of promotions, and optional store branding. Inventory tests are independent, so the selected file list makes accidental full-suite runs visible.

## Run the example

From the Rstest repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @examples/related-tests test
pnpm --filter @examples/related-tests reproduce
```

The application has three test files and four tests. The reproduction command copies it into a temporary Git repository, runs all scenarios, prints each command and its output, and removes the temporary repository. It exits with code 1 if any expected selection or exit code is wrong. It does not edit the original example or its Git history.

## Inspect individual selections

From this directory:

```bash
# A computed import selects checkout tests.
pnpm exec rstest list --filesOnly --related src/shipping/standard.mjs
# tests/checkout.test.ts

# A file read by the template loader selects receipt tests.
pnpm exec rstest list --filesOnly --related src/templates/footer.txt
# tests/receipt.test.ts

# A directory dependency also covers new or deleted promotion files.
pnpm exec rstest list --filesOnly --related src/templates/promotions/shipping.txt
# tests/receipt.test.ts

# Optional branding is registered even before the file exists.
pnpm exec rstest list --filesOnly --related src/templates/branding.txt
# tests/receipt.test.ts

pnpm exec rstest run --related src/shipping/standard.mjs src/templates/footer.txt
```

The final command runs two test files and three tests successfully.

The loader uses standard Rspack APIs: `addDependency`, `addContextDependency`, and `addMissingDependency`. The example does not supply a custom test selector.

## Before and after

The same reproduction script was run against upstream `main` at `8d799b8b7780547f0f4a30c2aea960ce1b805b3f` and the proposed fix:

| Scenario                                         | Before                                       | After                        |
| ------------------------------------------------ | -------------------------------------------- | ---------------------------- |
| Complete application suite                       | 3 files pass                                 | 3 files pass                 |
| Computed shipping import                         | No files selected                            | Checkout tests               |
| Loader file, directory, or missing input         | No files selected                            | Receipt tests                |
| Unrelated directory with the same prefix         | No files selected                            | No files selected            |
| Staged deletion of `src/pricing.ts`              | No files selected                            | Checkout tests               |
| Run after that deletion with `--passWithNoTests` | Exit 0: “No changed files found”             | Exit 1: importing test fails |
| Committed deletion of a configured rerun trigger | No files selected                            | All 3 test files             |
| Syntax error during dependency analysis          | Error printed, unrelated test passes, exit 0 | Selection stops with exit 1  |

To compare another Rstest checkout, build it first and pass its CLI to the script:

```bash
node examples/related-tests/scripts/reproduce.mjs /absolute/path/to/other/rstest/packages/core/bin/rstest.js
```

The script runs `rstest list --changed` after staging a deletion, and `rstest list --changed=HEAD~1` after committing deletion of `config/checkout.json`. That file is explicitly listed in `forceRerunTriggers`, demonstrating the existing configuration for inputs outside the module graph.

## Boundaries

Literal dynamic imports already worked before this fix. The improvement covers computed imports with a statically discoverable directory context. Arbitrary `import(runtimePath)` values and ordinary filesystem reads still need explicit application configuration, such as `forceRerunTriggers` for changed-test runs.

Deleted paths have empty virtual placeholders only while building the selection graph. The selected tests execute against the real files; the demo verifies that a deleted import cannot become a successful no-test run. Selection uses the current import graph and does not reconstruct imports removed in earlier commits.
