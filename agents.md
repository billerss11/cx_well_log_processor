
* Use the existing Conda environment named `cx_well_log_backend`.
* Do not create a separate `venv`, `uv` environment, or Poetry environment.
* Add Python dependencies through the project's existing Conda or pip dependency files.
* For this project, these Conda rules override references to `uv` in other documentation.

## Ground Rules

* Do not refactor unrelated code unless required by the task.
* Remove unused imports, dead code, and copied boilerplate from files you modify.
* Avoid adding new dependencies unless they provide clear value.
* Do not silently change existing APIs, data schemas, or project file formats.

## Architecture Rules
## Frontend and Desktop Rules

* Keep React components focused on presentation and user interaction.
* Keep file parsing, numerical processing, and data validation in Python.
* Keep Electron limited to desktop integration and application lifecycle.
* Put frontend orchestration, API calls, state management, viewport requests, and job progress handling in dedicated hooks, services, or feature modules.
* Keep engineering calculations, parsing, QC rules, and authoritative data transformations in Python.
* Keep Electron limited to desktop integration, process lifecycle, file dialogs, and controlled OS access.
* Keep Node integration disabled in the React renderer.
* Expose only a narrow, typed API through the Electron preload layer.
* React must not access the filesystem directly.

## Backend Architecture Rules

* Implement business operations in the shared Python application-service layer.
* The UI, CLI, Python API, and HTTP API must use the same application rules.
* Do not duplicate business logic in React, Electron, FastAPI routes, or CLI commands.
* Keep FastAPI routes and CLI commands as thin adapters around application services.
* Keep LAS, DLIS, and WITSML handling in separate format adapters.
* Convert imported data into the shared internal well-log model.
* Preserve original files, metadata, mnemonics, units, and curve values.
* Never modify original source files.
* Preserve source provenance, original metadata, mnemonics, units, null definitions, and imported values.
* Follow the project's configured managed-copy or referenced-source retention mode.
* Processing operations must create derived data rather than overwrite source data.
* Do not assume every log is measured-depth indexed or contains only scalar curves.

## Large Data and Storage Rules

* Never assume that a complete source file, dataset, frame, curve collection, or processing result fits in memory.
* Use bounded batches, streaming reads, partitioned storage, and visible-range queries for large data.
* Do not send complete large curves to the React frontend.
* Store project metadata and catalog records in DuckDB.
* Store scalar curve data in partitioned Parquet files.
* Store multidimensional image and waveform data through the array-storage abstraction, currently Zarr.
* Do not store complete curve arrays in public metadata objects or JSON API responses.
* Use Arrow IPC for large numerical responses.
* Only the main Python engine process may write to the project DuckDB catalog.
* Parser and processing workers must write staged artifacts and return manifests; they must not write directly to the project catalog.
* React and Electron must never open DuckDB, Parquet, or Zarr files directly.

## API and Contract Rules

* Use the generated OpenAPI TypeScript SDK for normal JSON API operations.
* Do not add handwritten `fetch` wrappers for endpoints covered by the generated SDK.
* Limit custom frontend transport code to Arrow IPC streams, job events, and Electron-specific integration.
* Do not manually edit generated API client files.
* Treat public Python models, HTTP endpoints, CLI JSON output, OpenAPI operation IDs, project schemas, and project file formats as versioned contracts.
* Do not make breaking contract changes without an explicit migration or versioning decision.
* Regenerate and validate the OpenAPI TypeScript SDK when the HTTP contract changes.

## Code Quality

* Use clear and descriptive names.

## Validation

* Sample input files for format testing are stored in `files/`.
* Existing sample input files for parser and integration testing are stored in `files/`.
* Do not modify sample or fixture source files during tests.
* Keep very large or proprietary test data outside the Git repository and document how tests locate it.
* Run the relevant formatter, linter, type checker, and tests after making changes.
* Add or update tests when behavior changes.
* Do not claim that checks passed unless they were actually run.
* Clearly report any checks that could not be run.