# CX Log format

CX Log (`.cxlog`) is the application's portable, converted well-log document
format. It is not a project folder and is never created as an automatic cache.
Users create it explicitly with **Save As**.

## Version 1 layout

A CX Log document is a ZIP64 archive with media type
`application/vnd.cx.welllog+zip`.

```text
manifest.json
catalog.duckdb
data/scalar/*.parquet
data/arrays/*.zarr/**
metadata/las/** | metadata/dlis/** | metadata/witsml/**
```

`manifest.json` declares the package version, package ID, producing engine,
source filename/format/version/size/SHA-256, and every packaged asset with its
size and SHA-256. `catalog.duckdb` contains the normalized dataset/channel
inventory and bounded scalar previews. Scalar data is stored in Parquet;
multidimensional samples are stored in Zarr.

The original LAS, DLIS, XML, EPC, or HDF5 file is not embedded. Absolute source
paths are not stored.

## Format adapters

LAS, DLIS, and WITSML remain separate source adapters. Each produces the shared
dataset/channel model plus preserved native metadata. The CX Log writer only
packages that shared result; it does not contain source-format parsing rules.
This keeps source-format differences out of the package implementation.

## Compatibility and safety

- Readers reject unsupported package versions.
- Archive paths are checked for traversal, duplicates, and symbolic links.
- Undeclared and missing assets are rejected.
- Asset size and SHA-256 checks are available through `welllog package verify`.
- Writes use a temporary sibling file followed by atomic replacement.
- Original source files are never modified.

Breaking layout or catalog changes require a new package version or an explicit
migration. Adding optional metadata within version 1 must remain readable by
existing version 1 readers.
