# Coil Experiment Dashboard

A standalone, static dashboard for Project 1 coil experiments. It computes the reference simulator's Model 1 and Model 2 fields locally, then compares repeated gaussmeter readings with the fixed target and the current theoretical model. No server, account, or connection to the reference repository is needed at runtime.

## Local run

From this directory, run `python -m http.server 8000` or `npx serve .`, then open `http://localhost:8000/`. ES modules need an HTTP origin; opening `index.html` directly with `file://` is not supported. Run `npm test` to check numerical parity (Node 20+).

## GitHub Pages deployment

Push this directory as the root of a GitHub repository. In **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. The generated `https://<user>.github.io/<repo>/` URL works without a build step because all asset paths are relative. If this directory lives inside a larger repository, copy its contents to a dedicated Pages repository or publish it from a root/docs folder instead.

## Vercel deployment

Import the repository into Vercel. Choose **Other** framework, leave the build command empty, and use `.` as the output directory. `index.html` is served at the project root. No environment variables or backend functions are required.

## Workflow

1. Open **Setup** and set current, wire diameter, coil geometry, winding directions, and target endpoints. Coordinates run from coil 1 center (`x=0`) to coil 2 center (`x=d`).
2. Select a position in the measurement panel, enter readings, then use **Save & next**. Enter advances through the reading fields. **Manage positions** adds, edits, deletes, or generates positions; chart points also select positions.
3. Compare the target, Model 2, and measured points in the field profile. **Curves** reveals optional weighted-fit, Model 1, and LM lines. The compact summary shows maximum target error and both RMSE values. Open **Analysis & records** only when needed for residuals, slope and theoretical-model details, or the full measurement table.
4. After at least three positions have readings, run **Advanced LM analysis** to estimate physical parameters. Choose free parameters and weighting; the table and before/after plots report the result. Strongly correlated parameters need cautious interpretation.
5. Runs autosave in the browser. **Save run** stores named snapshots, **Runs** loads or starts runs, and **Export** downloads JSON, CSV, or chart PNG. Advanced input accepts repeated-measurement text and CSV/TSV/TXT/XLSX (first worksheet).

## Reference mapping and numerical behavior

Reference: [ragel8326/coil-simulator](https://github.com/ragel8326/coil-simulator), `main/index.html` and `README.md`, inspected 2026-09-28. The repository is read-only input to this project. The reference README describes an endpoint-secant comparison in one paragraph, but `index.html`'s `evaluate()` implements the fixed `h1 → h2` target. This dashboard follows the executable source.

| Reference function or logic | Dashboard module |
| --- | --- |
| `OE`, `RHO`, `coilTurns()`, `turnCount()`, `H_pack()`, `H_thin()` | `js/physics.js` |
| `evaluate()`, `lsq()`, `findInflection()` | `js/physics.js` |
| `parseData()` grouping and sample STDEV, `SD_FLOOR`, weighted LSQ | `js/import.js`, `js/analysis.js` |
| `classifyHeader()`, `cellsToLines()`, text and XLSX file readers | `js/import.js` |
| `modelMaker()`, `FITSPEC`, `solveLin()`, `invert()`, `runFit()` LM math | `js/analysis.js` |
| Main/residual chart rendering and PNG export concept | `js/charts.js` |

Inputs in the UI are mm; the physics engine uses m. `evaluate()` samples 121 points on `[0,d]`. Its max and RMS deviation are against the fixed target, while nonlinearity is against the model's own least-squares line. Measurement weights are `n / max(sample SD, 0.1 / sqrt(12))²`. LM uses the same normal equations, damping, central-difference Jacobian, covariance, reduced chi-square, and correlation calculation as the reference.

## Verification and limits

`tests/parity.test.js` uses numbers obtained by executing the reference `main/index.html` functions on its default setup and example measurements. It checks five field positions, target, theoretical metrics, sample STDEV, weighted slope/R², and LM parameters/errors to `1e-9` absolute tolerance. The dashboard models ideal on-axis circular turns. It does not connect to instruments, simulate manufacturing tolerances, or estimate off-axis fields. Browser local storage is device/browser specific; export JSON for transfer or backup. XLSX import uses the browser's `DecompressionStream('deflate-raw')`, so use a current browser with that API.
