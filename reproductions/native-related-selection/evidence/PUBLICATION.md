# Fresh publication validation

This validation is separate from the historical research and benchmark records.
The consumer changes were applied to upstream Rstest base
`4bd5684812cf66dcab5b18a397dde26e4b8b2c9b`, then installed from the frozen lockfile
and rebuilt through pnpm, whose embedded Node version was 23.6.0. Behavioral
verification explicitly used Node 22.21.1. The actual resolved JavaScript dependencies were
published **Rsbuild 2.3.0 and Rspack 2.3.0**, with no links to a local Rspack
JavaScript checkout. The custom native producer binding was selected explicitly.

| Check                                                |    Result |
| ---------------------------------------------------- | --------: |
| Workspace package build                              |    Passed |
| Focused core selection, worker and Node-option tests | 48 passed |
| Native selection E2E                                 |  3 passed |
| Native selection E2E, CommonJS mode                  |  3 passed |
| Native selection E2E, worker threads                 |  3 passed |
| Native selection E2E, isolation disabled             |  3 passed |
| Full workspace type check                            |    Passed |
| Full lint                                            |    Passed |
| Unused-code check                                    |    Passed |
| Exported demo, strict declarations                   | 33 passed |
| Exported demo, native integration                    | 13 passed |
| Exported demo, final gap regressions                 | 34 passed |
| Exported demo, deleted target through symlink        |  9 passed |

The exported wrapper therefore passed **89/89 checks** again after final
formatting and relocation, against the rebuilt committed publication consumer.
[Compact smoke evidence](publication-smoke.json) records the
artifact fingerprints, script hashes, and hashes of the source validation logs.

A broader existing-selection E2E run reported **24 passed / 6 failed**. A separate
full-run control, with no changed/related selection, reproduced the coverage
failure independently of the metadata producer:

| Native build                                                  | Istanbul coverage | Result                            |
| ------------------------------------------------------------- | ----------------- | --------------------------------- |
| Published Rspack 2.3.0                                        | On                | Passed; two source files covered  |
| Custom producer, built with `DISABLE_PLUGIN=1`                | On                | Failed: `cannot find magic value` |
| Upstream-base build without producer, also `DISABLE_PLUGIN=1` | On                | Same failure                      |
| Custom producer, built with `DISABLE_PLUGIN=1`                | Off               | Passed                            |

All four controls passed their test assertion; the two failing commands failed
while producing coverage. [Sanitized coverage evidence](coverage-control.json)
records the binding hashes and observations. This isolates the observed failure
to the plugin-disabled build configuration rather than changed-test selection.
A plugin-enabled native build and coverage validation are still needed. This
note does not claim the entire E2E suite passes.

The historical workspace's 218 baseline type diagnostics remain part of that
earlier record. They are not the result of this fresh installation, whose full
type check passed. Historical benchmark measurements have not been rerun on the
publication rebuild, and the noisy final automatic-native timing remains
inconclusive.
