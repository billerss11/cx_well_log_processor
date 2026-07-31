# CX Well Log Processor

Offline well-log processing and visualization application built with React,
TypeScript, Electron, and Python.

The repository is a modular monolith. Business rules belong in the Python
application layer. The desktop UI, CLI, Python API, and local HTTP API call the
same services.

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- Conda environment `cx_well_log_backend`

## First-time setup

```powershell
conda activate cx_well_log_backend
python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -e "./python[dev]"
pnpm install
pnpm contracts:generate
```

## Development

Start the Python API, Vite renderer, and Electron shell together:

```powershell
conda activate cx_well_log_backend
pnpm dev
```

On Windows, you can also double-click `start-dev.bat` in the repository root.

The development API is available at `http://127.0.0.1:8765/api/v1`.

Useful commands:

```powershell
welllog doctor --output json
pnpm check
pnpm contracts:generate
```

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
