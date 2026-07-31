# Offline Well Log Processing and Visualization Platform

## Final High-Level Architecture Design - Subject to change

## 1. Design Goal

Build an offline-first professional well log workstation capable of:

-   LAS import
-   DLIS import
-   Offline WITSML dataset import
-   Large-scale well log visualization
-   Curve QC
-   Data cleaning and transformation
-   Derived curve generation
-   Export and project management

The application must support very large files (multi-GB LAS/DLIS/WITSML
datasets) without requiring the complete dataset to be loaded into
memory.

Core principles:

1.  Metadata-first architecture
2.  Streaming and bounded-memory processing
3.  Format-independent internal data model
4.  Non-destructive processing
5.  Local-first storage
6.  Scalable visualization

------------------------------------------------------------------------

# 2. Recommended Technology Stack

## Desktop Application

### Electron + React + TypeScript

Responsibilities:

-   Desktop window management
-   Application packaging
-   File dialogs
-   Native OS integration
-   Frontend hosting

React should not directly access files or databases.

------------------------------------------------------------------------

## Frontend

### React + TypeScript

Responsibilities:

-   Project explorer
-   Data browser
-   Log viewer
-   QC interface
-   Processing workflow
-   Export interface

Visualization:

-   Canvas/WebGL based custom well log renderer

Reason:

Well logs require:

-   Millions of points
-   Continuous zoom
-   Multiple synchronized tracks
-   Fast cursor movement
-   Depth-aligned rendering

Standard chart libraries are not suitable as the main rendering engine.

------------------------------------------------------------------------

## Backend

### Python

Responsibilities:

-   File parsing
-   Data conversion
-   QC
-   Processing
-   Storage management

Framework:

-   FastAPI for local API communication

Libraries:

-   lasio (LAS support)
-   dlisio (DLIS support)
-   XML streaming parser (WITSML)
-   NumPy
-   Polars
-   PyArrow
-   Pint
-   DuckDB

------------------------------------------------------------------------

# 3. Overall Architecture

    Electron Desktop Application

    React + TypeScript UI

            |
            | Local API
            |

    Python Backend Service

            |
            |
    --------------------------------

    Import Layer

    LAS Adapter
    DLIS Adapter
    WITSML Adapter

            |

    Canonical Well Log Model

            |

    Storage Layer

    DuckDB
    Parquet
    Zarr
    Cache

            |

    Visualization Query Engine

------------------------------------------------------------------------

# 4. Large File Strategy

The application must never assume:

-   The whole file fits into RAM
-   The whole dataset fits into a DataFrame
-   The whole curve can be sent to the browser

All processing uses:

    Read batch
        |
    Process batch
        |
    Write batch
        |
    Release memory
        |
    Continue

------------------------------------------------------------------------

# 5. Source File Handling

## LAS

Normal mode:

-   lasio reads metadata and data

Large LAS mode:

-   Parse headers
-   Stream ASCII section
-   Convert batches directly into Parquet

------------------------------------------------------------------------

## DLIS

DLIS contains:

-   Logical files
-   Frames
-   Channels
-   Multidimensional samples

Architecture:

    DLIS File

    Physical File

        |
    Logical Files

        |
    Frames

        |
    Channels

        |
    Canonical Model

Scalar channels:

-   Convert to Parquet

Image/waveform channels:

-   Preserve as arrays
-   Store using Zarr

------------------------------------------------------------------------

## WITSML

Support:

-   Offline XML exports

Do not support initially:

-   Live server connections
-   Real-time subscriptions

Use incremental XML parsing.

------------------------------------------------------------------------

# 6. Canonical Data Model

    Project

     └── Well

          └── Wellbore

               ├── Log Dataset
               |
               ├── Trajectory
               |
               ├── Formation Tops
               |
               ├── Annotations
               |
               └── Metadata

A curve consists of:

    Curve Definition

    - Original mnemonic
    - Display name
    - Description
    - Unit
    - Data type
    - Source metadata


    Curve Data Reference

    - Storage location
    - Partition information
    - Sample count
    - Depth range

Curve values are not permanently stored in memory.

------------------------------------------------------------------------

# 7. Storage Architecture

## Project Folder

    WellLogProject/

    project.json

    project.duckdb

    raw/
        original files

    datasets/
        parquet files

    arrays/
        zarr files

    cache/
        visualization cache

    exports/

------------------------------------------------------------------------

# 8. Database Design

## DuckDB

Stores:

-   Projects
-   Wells
-   Wellbores
-   Dataset metadata
-   Curve definitions
-   Processing history
-   QC results

DuckDB is the query engine.

------------------------------------------------------------------------

## Parquet

Stores:

-   Scalar curve values

Recommended:

    dataset/

        partition_001.parquet

        partition_002.parquet

        partition_003.parquet

Partition by:

-   depth interval
-   sample range

------------------------------------------------------------------------

## Zarr

Used for:

-   Borehole images
-   Waveforms
-   Multidimensional DLIS channels

------------------------------------------------------------------------

# 9. Visualization Architecture

The viewer uses synchronized tracks.

Example:

    Depth | Gamma Ray | Resistivity | Density | Neutron

Features:

-   Shared depth axis
-   Cursor synchronization
-   Zoom/pan
-   Formation tops
-   QC markers

------------------------------------------------------------------------

# 10. Visualization Performance

Never send raw millions of samples.

Frontend requests:

    curve
    depth range
    screen height

Backend returns:

    appropriate level of detail

Create LOD pyramid:

    Raw samples

        |

    LOD 1

        |

    LOD 2

        |

    LOD 3

Each bucket stores:

-   minimum
-   maximum
-   first
-   last
-   quality flags

This preserves spikes while reducing rendering load.

------------------------------------------------------------------------

# 11. Data Transport

Avoid JSON for large numerical arrays.

Use:

-   Apache Arrow IPC
-   Arrow streaming

Flow:

    DuckDB / Parquet

            |

    Python Backend

            |

    Arrow Stream

            |

    React Renderer

------------------------------------------------------------------------

# 12. Processing Architecture

All processing is non-destructive.

Example:

Original:

    GR

Processing:

    GR

     |

    Depth Shift

     |

    GR_shifted

Every derived curve stores:

-   source curves
-   algorithm
-   parameters
-   software version
-   timestamp

------------------------------------------------------------------------

# 13. Backend Module Structure

    backend/

    domain/

    adapters/

        las

        dlis

        witsml


    processing/

    quality/

    storage/

    services/

    api/

    workers/

Heavy operations run in worker processes:

-   Large imports
-   DLIS conversion
-   Batch processing

------------------------------------------------------------------------

# 14. Development Phases

## Phase 0

Architecture validation:

-   Canonical model
-   API design
-   Storage test
-   Rendering prototype
-   Large file benchmark

## Phase 1

LAS workstation:

-   Project management
-   LAS import
-   Metadata browser
-   Log viewer
-   QC

## Phase 2

DLIS:

-   Frames
-   Channels
-   Metadata preservation
-   Scalar visualization

## Phase 3

Processing:

-   Unit conversion
-   Filtering
-   Resampling
-   Depth shifting

## Phase 4

WITSML:

-   Offline XML import
-   Trajectory support

## Phase 5

Advanced logs:

-   Image logs
-   Waveforms
-   3D visualization

------------------------------------------------------------------------

# 15. Final Architecture Decision

  Component        Choice
  ---------------- ----------------------------
  Desktop          Electron
  UI               React + TypeScript
  Backend          Python + FastAPI
  LAS              lasio + streaming fallback
  DLIS             dlisio
  WITSML           Streaming XML adapter
  Database         DuckDB
  Scalar storage   Parquet
  Array storage    Zarr
  Transport        Arrow IPC
  Visualization    Custom Canvas/WebGL
  Processing       NumPy + Polars
  Units            Pint

------------------------------------------------------------------------

# Final Conclusion

The system should be designed as a professional data platform rather
than a simple file viewer.

The key architectural decisions are:

1.  Source formats are adapters only.
2.  Everything becomes a canonical well log model.
3.  Large data is processed in batches.
4.  Storage is columnar and partitioned.
5.  Visualization uses multiresolution data.
6.  Processing is reproducible and auditable.
7.  Advanced DLIS channels are preserved, not flattened.

This architecture can scale from small LAS files to professional logging
datasets containing tens or hundreds of gigabytes.
