# Offline Well Log Processing and Visualization Platform
## Final API-First High-Level Architecture Design

**Status:** Recommended baseline architecture  
**Primary deployment:** Fully offline desktop application  
**Secondary access:** Python API, command-line interface, and local HTTP API  
**Excluded:** MCP, live WITSML servers, cloud dependency, arbitrary code execution

---

## 1. Executive Decision

Build the product as an **offline, API-first modular monolith**.

The Python engine and its stable contracts are the product core. The Electron/React desktop interface is one client of that engine, not a separate implementation.

The same application capabilities should be accessible through:

1. Electron + React desktop UI
2. Public Python API
3. Deterministic command-line interface
4. Versioned local HTTP API
5. Generated TypeScript client used by the UI

All entry points must invoke the same application services and domain rules.

```text
                         Human user
                             │
                    Electron + React UI
                             │
                    Generated TypeScript SDK
                             │
                             ▼
┌──────────────┐     ┌────────────────────┐     ┌──────────────┐
│ Python user  │────▶│ Application Engine │◀────│ CLI / scripts│
│ / notebook   │     │ and service layer  │     │ / AI agents  │
└──────────────┘     └─────────┬──────────┘     └──────────────┘
                               │
                    Versioned local HTTP API
                               │
                       External local tools
```

This makes the software easier to:

- automate;
- test without the UI;
- use from Python notebooks and scripts;
- operate from coding agents through normal shell commands;
- integrate with future engineering workflows;
- reuse in a future web-hosted deployment.

The architecture is **API-first but not network-first**. It remains one local application, not a collection of microservices.

---

## 2. Product Scope

### 2.1 Initial scope

The application will support:

- LAS 1.2 and LAS 2.0 import;
- best-effort inspection of LAS 3.0, with explicit capability reporting;
- DLIS import;
- offline WITSML 1.4.1.1 XML import;
- later offline WITSML 2.1 XML and companion-array import;
- metadata inspection;
- scalar log visualization;
- large-file import and querying;
- quality-control checks;
- non-destructive processing;
- calculated and derived curves;
- trajectory, formation-top, and annotation data;
- export to supported engineering and analytical formats;
- local project management;
- headless operation through Python, CLI, and HTTP.

### 2.2 Explicit non-goals for the initial releases

- Live WITSML server connection
- ETP subscriptions or real-time acquisition
- Cloud accounts or cloud storage
- Collaborative multi-user editing
- Remote execution over the public internet
- Arbitrary SQL as a public API
- Arbitrary Python or JavaScript execution
- MCP integration
- Full interpretation or petrophysical modelling suite
- Immediate support for every vendor-specific DLIS object

---

## 3. Core Design Principles

1. **One engine, multiple clients**  
   UI, CLI, Python, and HTTP must not contain separate business logic.

2. **Metadata first**  
   Inspect file structure and estimate cost before loading sample data.

3. **Bounded memory**  
   No layer may assume that a complete file, dataset, frame, curve collection, or processing result fits in RAM.

4. **Immutable source data**  
   Original files and imported source revisions are never overwritten.

5. **Non-destructive processing**  
   Every processing operation creates a derived revision with provenance.

6. **Format-independent engine**  
   LAS, DLIS, and WITSML are adapters. Processing and visualization operate on the canonical model.

7. **Stable machine contracts**  
   Public models, command outputs, error codes, and API operations are versioned.

8. **Single writer per project**  
   One engine process owns all project metadata writes.

9. **Columnar and chunked storage**  
   Scalar logs use Parquet; multidimensional logs use Zarr.

10. **Screen-resolution-driven visualization**  
    Query and rendering cost should depend mainly on visible pixels and selected curves, not total file size.

11. **Auditable automation**  
    Agent or script actions use the same validation, preview, job, and history mechanisms as the UI.

12. **No unnecessary distributed architecture**  
    Keep deployment local and understandable.

---

## 4. Recommended Technology Stack

| Area | Recommended choice | Role |
|---|---|---|
| Desktop shell | Electron | Window lifecycle, packaging, file dialogs, OS integration |
| Frontend | React + TypeScript + Vite | Desktop UI and future web-portable UI |
| Scalar rendering | Custom Canvas 2D track engine | Curves, axes, grids, cursor, labels |
| Advanced rendering | WebGL, introduced only when needed | Image logs, waveforms, dense raster views |
| Backend language | Python | Parsing, processing, QC, storage, automation |
| Application API | Typed Python application services | One implementation of all operations |
| Local HTTP API | FastAPI | OpenAPI contract, UI communication, external automation |
| CLI | Typer | Human- and agent-friendly headless commands |
| Contract models | Pydantic | Validation and shared request/response models |
| Numeric arrays | NumPy | Core numerical representation and algorithms |
| Signal processing | SciPy where required | Filters, interpolation, signal operations |
| Columnar interchange | PyArrow / Arrow IPC | Bounded batches and binary API responses |
| Query engine | DuckDB | Metadata queries and analytical access to Parquet |
| Scalar storage | Parquet | Immutable columnar curve storage |
| N-dimensional storage | Zarr v3 behind an adapter | Borehole images, waveforms, multidimensional channels |
| Units | Pint plus an application unit-alias registry | Conversion while preserving original oilfield units |
| LAS parser | `lasio` plus a streaming fallback | Normal LAS files and metadata parsing |
| DLIS parser | `dlisio` in isolated workers | DLIS physical/logical files, frames, channels, metadata |
| WITSML parser | Incremental XML parser; later `h5py` as required | Offline WITSML files and companion arrays |
| Python environment | `uv` | Reproducible development and lockfile |
| JavaScript packages | `pnpm` | Reproducible frontend workspace |
| Python tests | pytest | Unit, integration, and contract testing |
| Frontend tests | Vitest + React Testing Library | UI/component testing |
| End-to-end tests | Playwright | Desktop/web workflow verification |
| Python packaging | PyInstaller in directory mode initially | Packaged offline Python sidecar |
| Desktop packaging | electron-builder | OS-specific installers |

### 4.1 Deliberate exclusions

#### No MCP

MCP is not needed for this product. Coding agents can reliably operate the CLI or HTTP API, and Python agents can use the Python package directly.

#### No Arrow Flight initially

Use Arrow IPC streams over normal HTTP. Apache Arrow supports IPC in JavaScript, but its current implementation matrix does not list JavaScript support for Arrow Flight. Ordinary HTTP also integrates more naturally with FastAPI and the browser-based renderer.

#### No PostgreSQL or server database

The application is offline and primarily single-user. DuckDB plus Parquet is simpler and more appropriate.

#### Polars is not a core dependency

DuckDB, PyArrow, NumPy, and SciPy cover the initial query, batch, and numerical requirements. Polars may be introduced later only when benchmarks demonstrate a clear need.

---

## 5. Architectural Style

Use a **modular monolith with ports and adapters**.

```text
┌──────────────────────────────────────────────────────────────┐
│                         Entry Points                         │
│                                                              │
│ Electron UI   Python API   CLI   Local HTTP API   Tests      │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                    Application Services                      │
│                                                              │
│ Project  Import  Query  Processing  QC  Export  Jobs         │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                         Domain Model                         │
│                                                              │
│ Well  Wellbore  Dataset  Curve  Revision  Provenance  QC     │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                         Adapters                             │
│                                                              │
│ LAS  DLIS  WITSML  DuckDB  Parquet  Zarr  Filesystem        │
└──────────────────────────────────────────────────────────────┘
```

Rules:

- Domain and application modules must not import FastAPI, Electron, or CLI code.
- FastAPI routes must be thin wrappers around application services.
- CLI commands must be thin wrappers around the same services or the HTTP client.
- React must call the generated TypeScript SDK for engine operations.
- Storage-specific objects must not leak into the public domain API.
- DataFrames must remain internal implementation details.

---

## 6. Programmatic Access Surfaces

## 6.1 Public Python API

Provide an installable package such as `welllog_engine`.

Example shape:

```python
from pathlib import Path
from welllog_engine import Engine

with Engine.open_project(Path("MyProject"), mode="read_write") as engine:
    inventory = engine.inspect_source(Path("large_file.dlis"))

    job = engine.import_source(
        source=Path("large_file.dlis"),
        selection=inventory.default_selection(),
    )

    result = job.wait()
    dataset = engine.get_dataset(result.dataset_ids[0])
```

Public API requirements:

- type hints on every public method;
- Pydantic request and result models;
- stable identifiers rather than display names;
- no requirement to understand DuckDB or project folder internals;
- synchronous convenience methods and explicit asynchronous job handles;
- context-managed project locks;
- clear exceptions with stable error codes;
- API documentation generated from docstrings and models.

Two Python usage modes should exist:

1. **In-process engine** for scripts, notebooks, batch jobs, and tests.
2. **HTTP client** for connecting to an already running desktop or headless service.

A project cannot be opened in write mode by both modes simultaneously. If the desktop engine owns the project, automation must use its HTTP API.

---

## 6.2 Command-Line Interface

Provide one executable, for example `welllog`.

Representative commands:

```text
welllog project create <folder>
welllog project info <folder> --output json
welllog inspect <source-file> --output json
welllog import <project> <source-file> --output jsonl
welllog wells list <project> --output json
welllog datasets list <project> --output json
welllog curves list <project> --dataset <id> --output json
welllog curves query <project> --curve <id> --from 2000 --to 3000 --output arrow
welllog process run <project> --spec operation.json --dry-run
welllog qc run <project> --dataset <id> --output json
welllog export <project> --spec export.json
welllog project verify <project>
welllog serve <project>
welllog api export-schema
welllog doctor
```

CLI design rules:

- stable subcommand and option names;
- `--output json` for one result document;
- `--output jsonl` for progress/event streams;
- binary Arrow output only when explicitly requested or sent to a file;
- deterministic exit codes;
- no ANSI formatting when output is redirected;
- `--dry-run` for mutating or expensive plans where practical;
- `--yes` or non-interactive mode for automation;
- stdout contains the requested result; diagnostics go to stderr;
- never require screen scraping of human-formatted tables;
- commands accept stable IDs as well as unambiguous names;
- every mutating command returns an operation/job ID.

The CLI is the simplest interface for many coding agents because it requires no custom protocol integration.

---

## 6.3 Local HTTP API

FastAPI exposes a versioned local API:

```text
http://127.0.0.1:<dynamic-port>/api/v1
```

Use OpenAPI as the machine-readable contract.

### Control plane

Use JSON for:

- projects;
- metadata;
- source inventories;
- import selections;
- processing specifications;
- QC results;
- jobs and status;
- errors;
- layouts and settings.

Representative endpoints:

```text
GET    /api/v1/health
GET    /api/v1/version
GET    /api/v1/capabilities
GET    /api/v1/openapi.json

POST   /api/v1/projects/open
GET    /api/v1/projects/current

POST   /api/v1/imports/inspect
POST   /api/v1/imports
GET    /api/v1/jobs/{job_id}
POST   /api/v1/jobs/{job_id}/cancel

GET    /api/v1/wells
GET    /api/v1/wellbores
GET    /api/v1/datasets
GET    /api/v1/datasets/{dataset_id}
GET    /api/v1/datasets/{dataset_id}/curves

POST   /api/v1/queries/curve-data
POST   /api/v1/queries/log-view

POST   /api/v1/processing/preview
POST   /api/v1/processing/jobs
POST   /api/v1/qc/jobs
POST   /api/v1/exports
```

### Data plane

Use Arrow IPC streaming responses for:

- raw or filtered scalar samples;
- visible-range curve data;
- crossplot tables;
- large tabular export previews;
- batch results.

Suggested content type:

```text
application/vnd.apache.arrow.stream
```

Do not encode large numeric arrays as JSON.

### Event plane

Every long operation must support polling through `GET /jobs/{id}`.

The desktop UI may additionally use a WebSocket event channel for responsive progress updates:

```text
/api/v1/events
```

Polling remains the guaranteed interface because it is simpler for scripts and agents.

### Contract rules

- Prefix all public routes with `/api/v1`.
- Assign explicit, stable OpenAPI operation IDs.
- Check the generated OpenAPI document into source control.
- Detect breaking API changes in CI.
- Generate the TypeScript client from OpenAPI.
- Return structured errors:

```json
{
  "error_code": "SOURCE_FORMAT_UNSUPPORTED",
  "message": "The source format is not supported by this engine version.",
  "details": {},
  "retryable": false,
  "operation_id": "op_..."
}
```

- Support an `Idempotency-Key` header for important mutating requests.
- Expose capability information instead of making clients guess feature support.

---

## 6.4 TypeScript Client

Generate the TypeScript control-plane client from FastAPI's OpenAPI schema.

The React application must use this client rather than handwritten fetch calls.

Add a small handwritten binary-data module for:

- Arrow IPC stream decoding;
- cancellation;
- backpressure;
- typed-array extraction;
- viewer-specific data structures.

```text
React feature
    │
    ├── Generated OpenAPI TypeScript client
    │       └── JSON commands and metadata
    │
    └── Arrow data client
            └── Large numeric responses
```

This causes frontend compilation and CI tests to reveal many contract mismatches early.

---

## 7. Desktop and Headless Operating Modes

## 7.1 Desktop mode

```text
Electron starts
    ↓
Electron launches packaged Python engine
    ↓
Engine selects an available loopback port
    ↓
Engine emits startup handshake
    ↓
Electron validates health, token, and API compatibility
    ↓
React uses the generated TypeScript client
```

Startup handshake should contain:

- port;
- one-time session token;
- process ID;
- engine version;
- API version;
- project format versions supported;
- startup error information.

## 7.2 Headless service mode

```text
welllog serve <project>
```

Use cases:

- automated testing;
- external local applications;
- long-running batch scripts;
- agent-driven operation;
- development without Electron.

Default behavior:

- bind to `127.0.0.1` only;
- require a generated token;
- refuse non-loopback binding unless explicitly enabled;
- write connection information to a protected token/connection file;
- keep API documentation local.

## 7.3 Direct library mode

Python scripts may bypass HTTP and call the application engine directly. This avoids serialization overhead and is ideal for notebooks and internal tests.

The domain behavior must be identical in direct and HTTP modes.

---

## 8. Canonical Well Log Model

```text
Project
└── Well
    └── Wellbore
        ├── Dataset
        │   ├── IndexAxis
        │   ├── CurveDefinition[]
        │   ├── DataRevision[]
        │   ├── SourceReference[]
        │   └── QualitySummary
        ├── Trajectory
        ├── FormationTopSet
        ├── AnnotationSet
        └── CoordinateReference
```

Additional project-level entities:

```text
SourceFile
SourceObject
ProcessingOperation
QualityResult
ImportJob
ExportJob
ViewerLayout
ProjectMigration
```

## 8.1 Dataset

A dataset is a collection of channels sharing one primary index or a compatible sampling model.

Mappings:

- LAS file data section → usually one dataset;
- DLIS frame → one dataset;
- LIS sample-rate group → one dataset;
- WITSML log/channel set → one or more datasets depending on indexing;
- trajectory stations → a trajectory object, not a normal scalar log dataset.

## 8.2 IndexAxis

```text
IndexAxis
- ID
- type: MD | TVD | TVDSS | TIME | ELAPSED_TIME | SAMPLE_NUMBER | OTHER
- original mnemonic
- original unit
- normalized unit
- direction
- reference datum
- reference elevation
- regular/irregular sampling
- min/max
- sample count
```

Do not infer TVD from MD without trajectory and datum information.

## 8.3 CurveDefinition

```text
CurveDefinition
- stable curve ID
- original mnemonic
- display mnemonic
- description
- original unit text
- normalized unit, when recognized
- data type
- sample shape
- null representation
- source object ID
- source tool/computation reference
- properties and quality summary
```

Mnemonics are not identifiers. Duplicate mnemonics are permitted and distinguished by stable curve IDs and source context.

## 8.4 CurveStorageReference

```text
CurveStorageReference
- curve ID
- revision ID
- storage kind: PARQUET | ZARR
- relative storage path
- column or array path
- partition list
- row/sample count
- index range
- checksum
```

Public metadata objects must never contain complete sample arrays.

## 8.5 SourceObject graph

Preserve a read-only source-object representation for information that does not fit neatly into the canonical model:

- DLIS logical files, frames, channels, tools, parameters, computations, origins, and vendor objects;
- WITSML object identifiers and relationships;
- original LAS header sections and items.

The canonical model supports normal operations. The source graph protects fidelity and future extensibility.

---

## 9. Source Format Adapters

Every adapter implements a common capability-oriented interface:

```python
class SourceAdapter:
    def probe(self, source: SourcePath) -> ProbeResult: ...
    def inspect(self, source: SourcePath) -> SourceInventory: ...
    def estimate(self, inventory: SourceInventory, selection: ImportSelection) -> ImportEstimate: ...
    def read_batches(self, source: SourcePath, selection: ImportSelection) -> BatchIterator: ...
    def read_metadata(self, source: SourcePath) -> SourceObjectGraph: ...
```

Capability fields should include:

```text
supports_metadata_only
supports_true_row_streaming
supports_channel_selection
supports_resume
supports_multidimensional_samples
supports_export
known_memory_limitations
```

Clients must be able to discover limitations before starting an import.

---

## 10. LAS Strategy

### Standard path

Use `lasio` for:

- LAS header parsing;
- metadata preservation;
- normal-sized LAS data;
- malformed-file policies already supported by the library;
- LAS export where compatible.

### Large-file path

For files above a configurable threshold:

1. Read headers without loading data.
2. Locate and validate the data section.
3. Stream rows into bounded Arrow record batches.
4. Apply null and parsing policies.
5. Write batches immediately to staged Parquet files.
6. Update incremental QC and LOD statistics.
7. Release batch memory.

The streaming fallback must handle:

- wrapped and unwrapped files;
- space and comma delimiters;
- comments;
- inconsistent row lengths;
- duplicate mnemonics;
- run-together negative numbers;
- encoding issues;
- unusual null indicators;
- reversed index direction.

LAS 3.0 support must be capability-reported and tested separately rather than implied by generic LAS support.

---

## 11. DLIS Strategy

DLIS is the highest-risk import format.

`dlisio` represents curve data as NumPy arrays accessed through frames and channels. DLIS channels may contain N-dimensional samples and rich metadata relationships.

### Import sequence

```text
DLIS physical file
    ↓
Logical files
    ↓
Metadata objects
    ↓
Frames
    ↓
Channels
    ↓
Canonical datasets and source-object graph
```

### Worker isolation

DLIS inspection and conversion must run in a separate worker process.

Benefits:

- parser crashes do not terminate the application;
- reliable release of NumPy memory when the worker exits;
- cancellation;
- per-worker memory limits;
- isolation of malformed vendor files;
- structured warning capture.

### Scalar channels

- Prefer frame-level reading when memory estimates are safe.
- Convert scalar channels to Arrow batches and Parquet.
- Preserve frame number, index channel, dimensions, source objects, and properties.

### Oversized frames

If a frame estimate exceeds the configured memory budget:

- allow channel selection;
- read smaller channel groups or individual channels;
- process logical files and frames independently;
- reject unsafe operations before allocation when the limit can be estimated.

### Known limitation

Current `dlisio` frame/channel APIs return NumPy arrays rather than a guaranteed row-batch stream. Therefore, a single exceptionally large channel or frame may still exceed memory even when the surrounding application is bounded-memory.

This limitation must be documented, benchmarked, and exposed through adapter capabilities. True arbitrary-size DLIS support may eventually require a lower-level chunked reader or upstream library contribution.

### Multidimensional channels

- Preserve original sample shape.
- Store image/waveform channels in Zarr.
- Do not flatten them into CSV or ordinary scalar tables.
- Scalar visualization may be released before image/waveform rendering.

---

## 12. Offline WITSML Strategy

As of this design, Energistics identifies WITSML 2.1 as the latest standard. WITSML 2.0 is no longer recommended for new implementation. WITSML 1.4.1.1 remains common in existing exported XML datasets.

### Phase A: WITSML 1.4.1.1

Support offline XML objects for:

- well;
- wellbore;
- log;
- trajectory;
- formation markers where present;
- relevant object identifiers and metadata.

Use incremental XML parsing and clear processed elements from memory.

### Phase B: WITSML 2.1

Support:

- XML object instances;
- current object identifiers and relationships;
- log/channel-set structures;
- companion HDF5 arrays where used;
- schema/version detection.

ETP is not required because the application imports offline files only.

### Rules

- Validate namespaces and declared schema versions.
- Preserve original UUIDs and object references.
- Do not silently map unknown objects into generic logs.
- Report unsupported objects in the import inventory.
- Keep the original XML and companion files available for audit.

---

## 13. Massive-File Import Pipeline

```text
Select or provide source
        ↓
Probe format and version
        ↓
Metadata-only inspection
        ↓
Build source inventory
        ↓
Estimate RAM, disk, objects, and limitations
        ↓
User/client chooses import selection
        ↓
Create persistent job and staging area
        ↓
Read bounded batch or bounded source unit
        ↓
Normalize and validate
        ↓
Write Parquet/Zarr staging data
        ↓
Update QC, statistics, and LOD cache
        ↓
Checkpoint progress
        ↓
Repeat
        ↓
Verify staged output
        ↓
Single-writer atomic metadata commit
        ↓
Expose completed dataset
```

### 13.1 Memory policy

Memory is controlled by bytes, not merely row count.

```text
estimated working bytes =
    samples
    × values per sample
    × bytes per value
    × selected channels
    × parser overhead factor
    × safety factor
```

Configurable budgets:

- engine working memory;
- each parser worker;
- query response size;
- frontend decoded data;
- visualization cache;
- concurrent worker count.

Concurrency must be reduced automatically when memory pressure is high.

### 13.2 Disk-space preflight

Before import, estimate:

- source-copy requirement;
- Parquet/Zarr output;
- staging overhead;
- visualization cache;
- safety reserve.

Refuse or warn before starting an import that cannot fit safely.

### 13.3 Resumability

Each long job stores a manifest:

```json
{
  "job_id": "job_...",
  "operation": "import",
  "source_fingerprint": "...",
  "state": "running",
  "completed_units": [],
  "current_unit": "...",
  "warnings": [],
  "engine_version": "...",
  "project_format_version": "..."
}
```

Resume is offered only when the adapter and operation can guarantee correctness.

### 13.4 Atomic completion

Workers write only to `staging/`. They do not write project catalog records directly.

The main engine:

1. validates staged artifacts;
2. moves or renames them into final locations;
3. commits DuckDB metadata in one controlled transaction;
4. marks the job complete.

A failed job must never appear as a complete dataset.

---

## 14. Local Project Storage

```text
MyWellLogProject/
├── project.json
├── catalog.duckdb
├── project.lock
├── sources/
│   ├── managed/
│   └── references.json
├── data/
│   ├── scalar/
│   │   └── <dataset-id>/<revision-id>/
│   │       ├── base-part-0001.parquet
│   │       ├── base-part-0002.parquet
│   │       └── derived-<operation-id>.parquet
│   └── arrays/
│       └── <dataset-id>/<revision-id>.zarr/
├── cache/
│   ├── lod/
│   ├── thumbnails/
│   └── query/
├── staging/
│   └── <job-id>/
├── exports/
├── logs/
└── backups/
```

## 14.1 Source retention modes

### Managed copy

Copy the original source into the project.

Best for:

- portable projects;
- controlled archives;
- smaller files;
- long-term reproducibility.

### Referenced source

Store:

- path;
- size;
- modification time;
- partial and/or full checksum;
- import timestamp.

Best for extremely large files where duplication is undesirable.

### Hard-link optimization

Where the filesystem supports it and source/project are on the same volume, the application may offer a hard-link option. It must remain an implementation optimization, not the only retention mode.

---

## 15. DuckDB Ownership and Concurrency

DuckDB is used for:

- project catalog;
- wells and wellbores;
- datasets and curve definitions;
- source-object indexes;
- QC results;
- processing history;
- layouts;
- job metadata;
- analytical queries over Parquet.

### Ownership rule

Only the main engine process may open `catalog.duckdb` in read-write mode.

Parser and processing workers:

- read immutable inputs;
- write staged Parquet/Zarr outputs;
- return manifests and results to the engine;
- never write the DuckDB catalog.

This follows DuckDB's single-writer-process model and avoids multi-process write conflicts.

### Project lock

- One read-write engine per project.
- Other clients connect to that engine through HTTP.
- Separate processes may open a project read-only when safe.
- Lock information records owner process, mode, engine version, and start time.
- Stale-lock recovery must verify that the owner process is no longer running.

---

## 16. Scalar Storage with Parquet

Use immutable Parquet files for scalar curves.

### Recommended layout

- Include a stable row ID and index column.
- Store groups of scalar curves that share the same index.
- Use column projection for selected curves.
- Use row-group statistics for visible index-range filtering.
- Sort storage by canonical row order while preserving original order metadata.
- Keep derived curves in new immutable files rather than rewriting source files.
- Map every curve ID to its file and column through the catalog.

### Partitioning

Do not partition solely by textual depth folders. Irregular, duplicate, reversed, and time-based indexes make this unreliable.

Partition by stable row/sample ranges and record index min/max metadata for each part.

```text
part-0001.parquet
- rows 0–199999
- index min/max

part-0002.parquet
- rows 200000–399999
- index min/max
```

Exact row-group and file sizes must be benchmarked. Start with moderate row groups and avoid both one giant file and thousands of tiny files.

### Compression

Start with Zstandard compression and allow benchmark-driven configuration.

---

## 17. Multidimensional Storage with Zarr

Use Zarr through a storage adapter for:

- borehole images;
- ultrasonic samples;
- waveform channels;
- multidimensional DLIS channels;
- future dense raster logs.

Design requirements:

- explicit array shape and dimensions;
- chunking aligned with depth/time access patterns;
- compression;
- checksums where appropriate;
- storage-format version recorded in the project manifest;
- sharding for very large arrays to prevent excessive tiny files;
- no direct frontend dependency on Zarr layout.

The backend reads requested chunks and returns viewer-ready data. React must not open project Zarr stores directly.

---

## 18. Query and Data-Delivery Architecture

### Metadata query

```text
Client → JSON API → application service → DuckDB → JSON response
```

### Scalar numeric query

```text
Client request
    ↓
Query service resolves curve storage references
    ↓
DuckDB reads only selected Parquet columns and row groups
    ↓
Result emitted as Arrow record batches
    ↓
HTTP Arrow IPC stream
    ↓
Arrow JS decodes typed arrays
```

### Multidimensional query

```text
Visible depth/time and image window
    ↓
Zarr chunk selection
    ↓
Backend decoding and optional normalization
    ↓
Binary response
    ↓
WebGL renderer
```

### Query safeguards

- maximum curves per request;
- maximum raw rows per request;
- maximum response bytes;
- server-side cancellation;
- request timeout;
- explicit raw-data permission in developer mode;
- LOD endpoint used by the UI by default.

---

## 19. Visualization Architecture

## 19.1 Track model

```text
LogView
├── Shared vertical viewport
├── Shared cursor and selection
├── Depth/time ruler track
├── Scalar curve track[]
├── Formation-top track
├── Annotation track
├── QC overlay
└── Later: image/waveform track
```

Initial track capabilities:

- linear and logarithmic horizontal scales;
- one or multiple curves per track;
- independent curve scales;
- shared depth/time navigation;
- null gaps;
- reversed index support;
- cursor readout;
- interval selection;
- formation tops;
- QC markers;
- track templates and saved layouts.

## 19.2 Rendering choice

Use a custom renderer:

- Canvas 2D for scalar curves, axes, text, grids, cursor, and annotations;
- ordinary React DOM for controls and panels;
- WebGL only for high-density image/waveform data;
- a Web Worker or OffscreenCanvas may be added after profiling.

D3 scale utilities may be used for scale calculations, but not as the primary renderer.

## 19.3 Level-of-detail pyramid

Never send all visible raw samples when many samples map to one pixel.

Each LOD bucket should preserve:

- first index/value;
- last index/value;
- minimum index/value;
- maximum index/value;
- null count or null spans;
- combined quality flags.

Ordering of extrema must be retained so spikes are drawn correctly.

```text
Raw samples
    ↓ aggregate
LOD 1
    ↓ aggregate
LOD 2
    ↓ aggregate
LOD 3 ...
```

The query request includes:

- curve IDs;
- visible index range;
- viewport pixel height;
- desired quality/point budget.

The backend selects the appropriate LOD and returns approximately screen-sized data.

LOD caches are derived and rebuildable. They are not the authoritative source data.

---

## 20. Processing Architecture

All operations are defined as typed specifications.

```json
{
  "operation": "depth_shift",
  "input_curve_ids": ["curve_..."],
  "parameters": {
    "shift": 1.5,
    "unit": "m"
  },
  "output": {
    "mnemonic": "GR_SHIFT"
  }
}
```

### Operation categories

#### Naturally batchable

- unit conversion;
- null replacement;
- clipping;
- simple formulas;
- QC statistics.

#### Batchable with overlap

- moving average;
- median filter;
- despiking;
- derivatives;
- convolution-based filters.

Each batch carries a left/right halo to avoid boundary artifacts.

#### Global or externally sorted

- non-monotonic index sort;
- large merges;
- certain resampling workflows;
- global statistics;
- cross-dataset joins.

Use DuckDB's out-of-core execution or purpose-built staged algorithms rather than collecting the entire dataset into one DataFrame.

### Provenance

Every derived revision stores:

- source dataset and curve IDs;
- operation name and version;
- complete parameters;
- software and plugin versions;
- start and completion time;
- warnings;
- output checksums;
- user/client identity label;
- operation/job ID.

---

## 21. Quality-Control Subsystem

QC is a separate subsystem, callable from UI, Python, CLI, and HTTP.

### Index checks

- duplicate values;
- non-monotonic order;
- reversed direction;
- irregular step;
- large gaps;
- missing or invalid index;
- inconsistent index unit or datum.

### Curve checks

- missing/unknown units;
- excessive nulls;
- constant sections;
- invalid numeric values;
- duplicate mnemonics;
- impossible sample shape;
- configured engineering-range warnings;
- mismatched sample count;
- suspicious spikes.

### Metadata checks

- missing well/wellbore identity;
- conflicting identifiers;
- missing coordinate reference;
- inconsistent depth references;
- broken DLIS relationships;
- unsupported WITSML objects;
- source-file parsing warnings.

QC results contain:

- stable rule code;
- severity;
- affected object/curve;
- index interval where applicable;
- message;
- evidence;
- rule version;
- optional suggested action.

QC warnings do not automatically alter data.

---

## 22. Jobs, Workers, and Cancellation

Operations expected to exceed a short interactive duration run as jobs:

- large imports;
- DLIS inspection/conversion;
- LOD generation;
- processing;
- QC over large datasets;
- export;
- project verification or migration.

```text
Application service
    ↓
Persistent job record
    ↓
Worker process or engine task
    ↓
Staged output and progress events
    ↓
Engine validation and commit
```

Job states:

```text
QUEUED
RUNNING
CANCELLING
CANCELLED
FAILED
COMMITTING
COMPLETED
```

Cancellation is cooperative. Workers must check cancellation at batch or source-unit boundaries.

A worker crash produces a failed job with retained diagnostics and safely disposable staging artifacts.

---

## 23. Agent- and Automation-Friendly Design

AI-specific protocols are unnecessary. Normal software interfaces are easier to test and maintain.

The following features make the application agent-friendly:

- self-describing OpenAPI contract;
- deterministic CLI with JSON/JSONL output;
- stable IDs and error codes;
- preview and `--dry-run` operations;
- idempotency keys;
- machine-readable capabilities;
- explicit job status and cancellation;
- no hidden UI-only behavior;
- complete provenance;
- project verification command;
- small built-in test fixtures;
- no arbitrary code execution;
- no direct database manipulation required.

### Required parity rule

Except for desktop-only functions such as opening a native file dialog or managing a window, every operation available in the UI must be available through the programmatic application layer.

### Useful test commands

```text
welllog doctor --output json
welllog inspect tests/data/sample.las --output json
welllog project verify tests/projects/reference-project --output json
welllog api export-schema --output openapi.json
```

---

## 24. Security and Offline Operation

### Electron

- renderer sandbox enabled;
- Node integration disabled;
- context isolation enabled;
- restrictive Content Security Policy;
- narrow preload bridge;
- validate IPC sender and arguments;
- no remote code loaded into privileged renderer;
- only packaged local frontend assets.

### Local backend

- bind to loopback only by default;
- dynamic port in desktop mode;
- random session bearer token;
- no unauthenticated mutation endpoints;
- restrict CORS to the application origin where used;
- path validation and configurable allowed roots;
- no arbitrary SQL or shell execution;
- rate and response-size limits;
- validate all request models.

### Data privacy

- no cloud account;
- no external API requirement;
- no online authentication;
- no telemetry by default;
- logs remain local;
- internet access is not required after installation.

---

## 25. Project Format, Migrations, and Recovery

Record separately:

- engine version;
- public API version;
- project format version;
- DuckDB schema version;
- Parquet storage schema version;
- Zarr format/version;
- processing operation versions.

### Migration rules

- migrations are explicit and testable;
- create a backup or recovery point before destructive metadata migrations;
- original source files are never modified;
- derived caches may be rebuilt instead of migrated;
- older projects may open read-only if safe migration is unavailable;
- the CLI exposes migration preview and verification.

### Recovery

- staging jobs are discoverable after restart;
- incomplete commits are detected;
- catalog and artifact checksums can be verified;
- missing referenced sources are reported without corrupting imported data;
- cache deletion never destroys authoritative data.

---

## 26. Repository Structure

```text
welllog-platform/
├── apps/
│   └── desktop/
│       ├── electron/
│       └── renderer/
├── packages/
│   ├── ts-api-client/          # generated OpenAPI client
│   ├── arrow-data-client/      # binary query client
│   └── log-renderer/           # Canvas/WebGL track engine
├── python/
│   ├── welllog-domain/
│   ├── welllog-application/
│   ├── welllog-adapters/
│   ├── welllog-api/
│   ├── welllog-cli/
│   └── welllog-sdk/
├── schemas/
│   ├── openapi.json
│   ├── project-format/
│   └── processing-specs/
├── tests/
│   ├── fixtures/
│   ├── golden-files/
│   ├── integration/
│   ├── contract/
│   ├── performance/
│   └── e2e/
├── docs/
└── tools/
```

This may be implemented as fewer Python distributions initially. The boundaries matter more than publishing many packages.

---

## 27. Testing Strategy

## 27.1 Domain and application tests

- canonical model invariants;
- unit conversion;
- processing algorithms;
- provenance;
- project locking;
- error codes;
- migration logic.

## 27.2 Adapter golden-file tests

Maintain licensed or internally generated examples covering:

- normal LAS;
- wrapped LAS;
- malformed LAS;
- duplicate mnemonics;
- large LAS;
- multiple DLIS logical files;
- duplicate/broken DLIS channels;
- N-dimensional DLIS channels;
- corrupted/truncated DLIS;
- WITSML 1.4.1.1 XML;
- WITSML 2.1 packages when implemented.

Expected metadata, warnings, checksums, sample counts, and selected values are stored as golden results.

## 27.3 Contract tests

For each core operation, verify consistent semantics through:

- direct Python API;
- HTTP API;
- CLI;
- generated TypeScript client where relevant.

OpenAPI snapshot changes require review.

## 27.4 Storage tests

- projection/filter correctness;
- partition pruning;
- crash during staging;
- failed atomic commit;
- stale project locks;
- source reference changes;
- cache rebuild;
- migration and rollback.

## 27.5 Performance and memory tests

Define benchmark tiers rather than assuming success:

```text
Tier S: ordinary engineering files
Tier M: multi-gigabyte source
Tier L: tens-of-gigabytes project
Tier XL: stress corpus approaching hundreds of gigabytes
```

Measure:

- peak resident memory;
- import throughput;
- disk amplification;
- time to first metadata;
- time to first visible track;
- visible-range query latency;
- pan/zoom frame rate;
- cancellation latency;
- cache build cost.

The acceptance rule is that peak memory remains within configured budgets, except for explicitly reported parser limitations such as an unchunkable DLIS channel.

## 27.6 Desktop tests

- Python sidecar startup and shutdown;
- version handshake;
- token handling;
- file selection;
- project open/close;
- renderer/API compatibility;
- worker crash recovery;
- packaged offline operation.

---

## 28. Packaging and Distribution

### Development

- Python dependencies locked with `uv`.
- JavaScript dependencies locked with `pnpm`.
- Generate OpenAPI and TypeScript SDK in CI.
- Build and test on each supported operating system.

### Desktop release

- Package the Python engine as a directory-based sidecar initially; this is easier to inspect and generally more reliable for native libraries such as `dlisio` than a single self-extracting binary.
- Electron starts and supervises the sidecar.
- Build separate installers for Windows, macOS, and Linux.
- Include all required runtime libraries and schemas.
- Verify installation and import with offline smoke tests.

### Command-line distribution

The desktop installation should include the `welllog` CLI or provide an explicit command to install a launcher onto the user's PATH.

### Web deployment later

The React UI and generated API client are reusable, but a web deployment requires a separately hosted Python backend, authentication, storage isolation, and file-upload design. It is not merely an Electron build setting.

---

## 29. Development Phases

## Phase 0 — Architecture and risk validation

- Define canonical model.
- Define public Python interfaces.
- Define API v1 and error model.
- Build CLI skeleton with JSON output.
- Generate TypeScript client from OpenAPI.
- Package minimal Python sidecar.
- Prototype scalar renderer with four synchronized tracks.
- Benchmark Parquet layout and Arrow IPC.
- Test representative malformed and large files.
- Prove project locking and single-writer behavior.

**Exit criterion:** one operation works consistently through Python, CLI, HTTP, and the desktop UI.

## Phase 1 — LAS API-first workstation

- Project create/open/verify.
- LAS inspect and import.
- Metadata browser.
- Scalar curve listing and range query.
- Canvas track viewer.
- Basic QC.
- CSV, Parquet, and LAS export.
- Headless `welllog serve` mode.

## Phase 2 — Large LAS and production storage

- Streaming LAS fallback.
- Persistent job manifests.
- cancellation and recovery;
- disk/memory preflight;
- LOD pyramid;
- source managed/reference modes;
- storage migration framework.

## Phase 3 — DLIS scalar logs

- isolated DLIS workers;
- logical file/frame/channel inventory;
- source metadata graph;
- scalar frame/channel import;
- memory-limit reporting;
- unsupported-object reporting;
- robust vendor-file test corpus.

## Phase 4 — Processing and advanced QC

- unit conversion;
- resampling;
- filters and despiking;
- depth shift;
- calculated curves;
- provenance UI and API;
- batch/halo processing;
- configurable QC rules.

## Phase 5 — Offline WITSML

- WITSML 1.4.1.1 XML;
- wells, wellbores, logs, trajectories;
- incremental parsing;
- object-reference preservation;
- schema validation and capability reporting.

## Phase 6 — Advanced arrays and WITSML 2.1

- Zarr storage adapter;
- multidimensional DLIS channels;
- image and waveform tracks;
- WebGL renderer;
- WITSML 2.1 XML;
- companion HDF5 array support where required.

---

## 30. Main Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Single enormous DLIS frame/channel | May exceed memory | Preflight, channel selection, isolated worker, explicit limitation, investigate lower-level reader |
| Vendor-noncompliant files | Incorrect or failed import | Preserve warnings, strict/best-effort modes, golden corpus, source graph |
| Custom log renderer complexity | Schedule risk | Build renderer prototype in Phase 0; keep initial track types limited |
| Too many storage files | Filesystem slowdown | Moderate Parquet grouping; Zarr v3 sharding; benchmark layouts |
| API/UI feature drift | Automation inconsistency | UI uses generated client; parity rule; contract tests |
| DuckDB write conflicts | Project corruption or failures | One writer process; workers stage files only; project lock |
| Project format evolution | Old projects become unreadable | Explicit versions, migrations, backups, read-only fallback |
| Agent makes unsafe changes | Data loss | Immutable data, dry-run, idempotency, job history, no arbitrary code/SQL |
| Packaging native parsers | Installation failure | Per-OS CI, directory sidecar, packaged smoke tests |
| Overengineering too early | Slow development | Modular monolith, no MCP, no microservices, defer WebGL/Zarr until required |

---

## 31. Final Architecture Decision Table

| Decision | Final choice |
|---|---|
| Product shape | Offline API-first modular monolith |
| Human interface | Electron + React + TypeScript |
| Programmatic interfaces | Python API + CLI + local HTTP API |
| AI-agent interface | Normal CLI/HTTP/Python; no MCP |
| Backend | Python application engine |
| HTTP framework | FastAPI with versioned OpenAPI |
| Frontend client | Generated TypeScript SDK |
| Large numeric transport | Arrow IPC stream over HTTP |
| Job progress | Polling baseline; WebSocket for UI convenience |
| Metadata/catalog | DuckDB, owned by one writer process |
| Scalar data | Immutable Parquet parts |
| Multidimensional data | Zarr v3 through a backend adapter |
| LAS | `lasio` plus bounded-memory streaming fallback |
| DLIS | `dlisio` in isolated workers, with explicit large-frame limitation |
| WITSML | 1.4.1.1 first; 2.1 later; offline files only |
| Processing | NumPy + SciPy + DuckDB/PyArrow batches |
| Visualization | Canvas 2D scalar engine; WebGL for advanced arrays |
| Source data | Managed copy, reference, or supported hard link |
| Mutations | Non-destructive, job-based, staged, atomic |
| Security | Loopback token, sandboxed renderer, narrow preload API |
| Web future | Reuse UI/API contracts with a separately hosted backend |

---

## 32. Final Recommendation

Proceed with the proposed React, Electron, and Python direction, but make the **application engine and programmatic contracts the center of the design**.

The most important architectural rule is:

> The desktop UI must use the same public application operations that scripts, tests, the CLI, and local API clients use.

This provides the benefits sought for AI-agent operation without introducing an AI-specific protocol:

- agents can inspect and operate the application through stable shell commands;
- tests can exercise the engine without rendering the UI;
- Python users can build reproducible technical workflows;
- the frontend and automation interfaces cannot silently diverge;
- large-file operations retain the same memory limits, validation, jobs, and provenance regardless of the client.

The recommended architecture remains practical for a small development team because it is still one application and one engine. It avoids microservices, MCP, a server database, and duplicated business logic while preserving a path to a professional, extensible well-log platform.

---

## 33. Research Basis

The architecture was checked against the following primary documentation:

1. FastAPI — OpenAPI metadata and automatic API schema/documentation:  
   https://fastapi.tiangolo.com/tutorial/metadata/

2. FastAPI — generating TypeScript SDKs from OpenAPI:  
   https://fastapi.tiangolo.com/advanced/generate-clients/

3. FastAPI — API testing with `TestClient` and pytest:  
   https://fastapi.tiangolo.com/tutorial/testing/

4. OpenAPI Specification:  
   https://spec.openapis.org/oas/

5. Apache Arrow — IPC streams and bounded record-batch writing:  
   https://arrow.apache.org/docs/python/ipc.html

6. Apache Arrow — implementation matrix, including JavaScript IPC and Flight status:  
   https://arrow.apache.org/docs/status.html

7. DuckDB — concurrency and single-writer-process considerations:  
   https://duckdb.org/docs/current/connect/concurrency

8. DuckDB — Parquet projection/filter pushdown:  
   https://duckdb.org/docs/stable/data/parquet/overview

9. Zarr — chunking and Zarr v3 sharding:  
   https://zarr.readthedocs.io/en/latest/user-guide/arrays/

10. dlisio — frames, channels, N-dimensional samples, and NumPy curve access:  
    https://dlisio.readthedocs.io/en/latest/dlis/curves.html

11. dlisio — DLIS user guide and frame/channel reading:  
    https://dlisio.readthedocs.io/en/latest/dlis/userguide.html

12. lasio — metadata-only reading and data-engine behavior:  
    https://lasio.readthedocs.io/en/v0.32/lasio.html

13. Energistics — WITSML v2.1 is the latest standard and v2.0 is no longer recommended:  
    https://energistics.org/witsml-developers-users

14. Energistics — WITSML 1.4.1.1 XML schema overview:  
    https://energistics.org/sites/default/files/witsml_data_schema_overview.html

15. Electron — security recommendations:  
    https://www.electronjs.org/docs/latest/tutorial/security

16. Electron — context isolation:  
    https://www.electronjs.org/docs/latest/tutorial/context-isolation

17. Typer — typed CLI application design:  
    https://typer.tiangolo.com/tutorial/
