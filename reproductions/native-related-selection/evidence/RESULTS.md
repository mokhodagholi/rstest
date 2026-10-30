# Recorded validation and performance

These results describe local reviewed artifacts, based on Rstest source
`f2b4bf0f9bda7973015363c33b9d68dac3c80379`. They are not results of an upstream
release or a claim that maintainers have accepted the proposed policy. The
portable scripts and compact evidence contain only synthetic commerce fixtures.
Native binaries, private paths, generated scale trees, and raw command logs are
not included.

## Correctness

| Suite                                         | Final result | Scope                                                                                              |
| --------------------------------------------- | -----------: | -------------------------------------------------------------------------------------------------- |
| Core selection, scanner and Node-option tests |    48 passed | Implementation repository unit tests; not duplicated in this demo                                  |
| Strict selection and runtime mutations        |    33 passed | Complete declared closures; exact file sets, source aliases, unused invalid candidates             |
| Native integration                            |    13 passed | Actual native metadata, traversal rejection, resolve-only targets, concatenation, unchanged assets |
| Final review regressions                      |    34 passed | Default createRequire diagnostics, CommonJS var require, loader flags/files, exact declarations    |
| Deleted target through an existing symlink    |     9 passed | Same explicit physical --related path before/after deletion; exact failing consumer                |

The before-gap run retained eight failing assertions, and the before-symlink-fix
run retained two. Full runs pass before mutations and fail after them, so the
tests demonstrate real runtime dependencies. Complete declarations select only
their consumers, excluding unrelated tests. Check identities and before/after
results are in [validation.json](validation.json).

After portable packaging, the exported wrapper passed all **89 native-mode
checks** (33 + 13 + 34 + 9) again. Its independent API-only mode also passed
**33/33** against the preserved clean upstream core and baseline native binding.
[Portable smoke evidence](portable-smoke.json) identifies the exported scripts
and artifact hashes. Benchmark timings were not rerun during packaging.

The workspace-wide checks were not clean passes: **218 TypeScript diagnostics**
matched the original-source baseline exactly, and unused-code failures were
unchanged. Focused behavioral passes do not erase those existing failures.

## Final artifact measurements

The final focused matrices passed **148 invocations / 18 cases** with exact
selected sets and unchanged artifact hashes. The 3000-test commerce project
contained 6026 source files in one Rstest project. Computed imports used complete
declarations; literal require.resolve used the native descriptor path.

| Workload                        | Selected | Before median | Final median |
| ------------------------------- | -------: | ------------: | -----------: |
| Static selection                |        1 |       2413 ms |      2286 ms |
| Dynamic selection               |       20 |       2286 ms |      2301 ms |
| Literal native resolve          |       10 |       2297 ms |      2267 ms |
| Unrelated input                 |        0 |       2195 ms |      2217 ms |
| Dynamic selected-test execution |       20 |       3104 ms |      3074 ms |

All five observed ranges overlap. The small differences do not prove stable
speedups or zero overhead. Every selected execution checks that all 20 tests
pass. The focused matrix did not repeat a full 3000-test runtime run. Both
compilation gates contained all 3000 test modules and emitted byte-identical
3001 JavaScript assets.

The separate automatic-native fixture uses **100 tests / 802 native CommonJS
files** with no declarations. Both full runtime gates passed, and both emitted
the same 101 assets. Its final timing run is **inconclusive**: host load rose
from about 6 to 28 on an eight-logical-CPU laptop, causing multi-second outliers
on both sides. Every sample is retained in [performance.json](performance.json).

An earlier, cleaner seven-sample comparison measured early-match selection at
**293 → 396 ms** (+102.5 ms / 35.0%) after complete-closure validation was added.
That measurement predates the final symlink fix and is labeled separately.
Final unmeasured worker controls still show **100 → 802 source reads/parses**
and **200 → 1000 resolutions**, while selecting exactly the same 100 consumers.
The extra work prevents a supported early match from hiding an unsupported
dependency later in the closure. This is a real correctness cost, not a claim
that every workload becomes faster.

Measurements used Node 22.21.1, an 8 GiB Apple M1, warm OS caches, fresh serial
CLI processes, two warmups, and five final samples per case. Earlier focused
results used seven samples. Peak final process maximum RSS was 677.7 MiB for
commerce and 155.8 MiB for native closure. This is macOS process rusage, not
simultaneous aggregate CLI/worker memory. The earlier broad 939-invocation
experiment predates final review fixes and is retained as summary-only history.

## Artifact identity and boundaries

Final compiled core (73 JavaScript files):
`62104e0d09c2c2cf2ce3c168ec6c6a85677dbc07458244380e42fcfa497edac9`.

Final native binding SHA-256:
`3a49ef781ccc89266338aadf868a88a3aac59d7eccd25c605c15a6ff7c0fa164`.

The evidence includes the corresponding before/after fingerprints and hashes
of the local source evidence. Historical binary snapshots are not distributed;
the benchmark scripts accept reviewer-built revisions. The public wrapper adds
portable paths and clearer descriptions to the tested scripts; it does not
claim that historical measurements were rerun after packaging.

Exactness means the complete **potential dependency graph**, not the branch
executed by one test invocation. Arbitrary computed values still require an
explicit contract. Real application/CI performance, independent multi-project
orchestration, cold caches, browser/Rstest watch behavior, and universal loading
hook detection remain outside the validated scope. The work does not fix Git's
staged/committed deleted-path discovery.
