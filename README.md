# CX Well Log Processor

Offline well-log processing and visualization application built with React,
TypeScript, Electron, and Python.

The repository is a modular monolith. Business rules belong in the Python
application layer. The desktop UI, CLI, Python API, and local HTTP API call the
same services.

## Prerequisites

- Node.js 22 or newer
- Conda
- Corepack, included with Node.js 22

The shared development configuration is:

- pnpm `10.6.2`, selected from `package.json` through Corepack
- Python `3.11` in Conda environment `cx_well_log_backend`
- Python API at `http://127.0.0.1:8765`
- Vite renderer at `http://127.0.0.1:5174`
- Direct localhost connections through `NO_PROXY=127.0.0.1,localhost`

## First-time setup

```text
setup-dev.bat
```

The setup script is safe to rerun after `git pull`. It creates or updates the
shared Conda environment and installs the frozen JavaScript and Python
dependencies. It does not regenerate tracked source files.

Verify the complete environment locally, without GitHub Actions:

```text
verify-dev.bat
```

Verification runs linting, type checks, tests, builds, and a live smoke test of
the API, Vite renderer, and Electron process. The smoke test stops only the
process tree that it started.

## Development

Start the Python API, Vite renderer, and Electron shell together:

```text
start-dev.bat
```

You can double-click any of the `.bat` files from Windows Explorer.

The development API is available at `http://127.0.0.1:8765/api/v1`.

## CX Log documents

The desktop can open LAS, DLIS, local WITSML XML/EPC, and `.cxlog` files. Raw
well-log files open as temporary sessions. **Save As** writes a portable
`.cxlog` document so the converted data does not need to be parsed again.

CX Log is a versioned ZIP64 package containing:

- a manifest with source provenance and asset checksums;
- a DuckDB metadata catalog;
- Parquet files for scalar curves;
- Zarr storage for multidimensional channels and companion HDF5 arrays;
- preserved source metadata, without embedding the original source file or an
  absolute source path.

It is an explicit document format, not an automatic cache or a project folder.
Temporary working data is removed when the document or engine closes, and
stale crashed sessions are cleaned on startup.

See `docs/cxlog_format.md` for the versioned layout and compatibility rules.

Useful commands:

```powershell
conda run -n cx_well_log_backend welllog doctor --output json
conda run -n cx_well_log_backend welllog inspect files/test.las
conda run -n cx_well_log_backend welllog qc run files/test.las --index-candidate curve:0
conda run -n cx_well_log_backend welllog convert files/test.las output.cxlog
conda run -n cx_well_log_backend welllog package verify output.cxlog
conda run --no-capture-output -n cx_well_log_backend corepack pnpm check
conda run --no-capture-output -n cx_well_log_backend corepack pnpm contracts:generate
```

When Python dependencies change in `python/pyproject.toml`, regenerate
`python/requirements-dev.lock.txt` from Python 3.11 with `pip-tools`. Commit
both files together. When JavaScript dependencies change, commit the matching
`pnpm-lock.yaml` update.

## Repository layout

```text
apps/desktop/                 Electron shell and React renderer
packages/ts-api-client/       Generated OpenAPI TypeScript client
packages/arrow-data-client/   Arrow IPC transport boundary
packages/log-renderer/        Well-log rendering boundary
python/                       Python engine, API, CLI, and tests
schemas/                      Versioned public contracts
tests/                        Cross-surface and end-to-end tests
tools/                        Development utilities
```

See `docs/offline_well_log_application_high_level_design.md` for the full
architecture.
