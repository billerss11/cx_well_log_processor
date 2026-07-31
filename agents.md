# AGENTS.md

## Project Context

* This is an offline well-log processing and visualization application.
* Main stack: React, TypeScript, Electron, and Python.
* Supported formats include LAS, DLIS, and local WITSML files.
* The application must not depend on cloud services or live well-log servers.

## Ground Rules

* Keep changes small, focused, and easy to review.
* Prioritize readability and maintainability.
* Follow the existing project structure and coding patterns.
* Reuse existing components, hooks, utilities, types, and services before creating new ones.
* Keep the design extensible for planned features, but do not add speculative abstractions.
* Do not overengineer or overcomplicate simple solutions.
* Do not refactor unrelated code unless required by the task.
* Remove unused imports, dead code, and copied boilerplate from files you modify.
* Avoid adding new dependencies unless they provide clear value.
* Do not silently change existing APIs, data schemas, or project file formats.

## Architecture Rules

* Keep React components focused on presentation and user interaction.
* Keep file parsing, numerical processing, and data validation in Python.
* Keep Electron limited to desktop integration and application lifecycle.
* Keep LAS, DLIS, and WITSML handling in separate format adapters.
* Convert imported data into the shared internal well-log model.
* Preserve original files, metadata, mnemonics, units, and curve values.
* Processing operations must create derived data rather than overwrite source data.
* Do not assume every log is measured-depth indexed or contains only scalar curves.

## Code Quality

* Use clear and descriptive names.
* Prefer small functions and components with one responsibility.
* Avoid `any` in TypeScript unless there is a documented reason.
* Use Python type hints for public functions and important data structures.
* Handle errors explicitly; do not silently ignore failures.
* Add comments only when they explain a non-obvious decision.

## Validation

* Run the relevant formatter, linter, type checker, and tests after making changes.
* Add or update tests when behavior changes.
* Do not claim that checks passed unless they were actually run.
* Clearly report any checks that could not be run.
