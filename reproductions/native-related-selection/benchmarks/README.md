# Optional focused benchmarks

Run the two matrices sequentially on an idle machine using Node 22.21.1. Both
artifacts must use comparable optimized native release settings. No benchmark
can turn a failed exact-selection/runtime gate into a valid timing result.

First create local profiles; the generated file paths are not publication inputs:

```sh
node scripts/benchmark-profiles.mjs \
  --before-cli /path/to/before/packages/core/bin/rstest.js \
  --before-binding /path/to/before/rspack.node \
  --after-cli /path/to/after/packages/core/bin/rstest.js \
  --after-binding /path/to/after/rspack.node \
  --output test-results/profiles
```

The 3000-test commerce fixture uses complete declarations for computed imports
and actual native metadata for literal `require.resolve`. It checks complete
compilation, exact selections, and timed execution of the selected 20-test case:

```sh
node benchmarks/commerce/benchmark.mjs \
  --config test-results/profiles/commerce.json \
  --output test-results/commerce --sizes 3000 \
  --workloads static-leaf,dynamic-esm,literal-native,unrelated,dynamic-esm-run \
  --samples 5 --warmups 2 --full-gate-profiles ''
```

The smaller automatic-native fixture has 100 tests and 802 CommonJS files,
including eight-stage chains with shared early/late helpers. It has no dependency
declarations, and it executes all 100 tests in both runtime gates:

```sh
node benchmarks/native-closure/benchmark.mjs \
  --config test-results/profiles/native-closure.json \
  --output test-results/native-closure --sizes 100 \
  --workloads shared-fanout,shared-late,deep-leaf,unrelated \
  --samples 5 --warmups 2
```

Every measurement checks the exact selected set. Artifacts are hashed before and
after. The automatic-native gate also checks actual request metadata and that no
native closure files were bundled. Timing includes fresh CLI startup and analysis;
only `-run` workloads also execute tests. RSS uses macOS `/usr/bin/time -l` and
does not measure simultaneous aggregate worker memory. The timing harness is
therefore macOS-specific; the generators and correctness scripts are separate.

The recorded final automatic-native run was disturbed by severe background
load, so its timing comparison is inconclusive. All samples remain in
[the compact measurement evidence](../evidence/performance.json). The earlier
cleaner comparison measured the additional work of complete-closure validation;
it belongs to a different, explicitly identified core revision.
