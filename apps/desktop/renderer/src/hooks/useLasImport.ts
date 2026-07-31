import type { LasImportResponse } from "@welllog/ts-api-client";
import { useCallback, useState } from "react";

import { importLasFromPath } from "../services/engineApi";
import type {
  CurveDefinition,
  WorkspaceDataset,
} from "../features/workspace/workspaceTypes";

const curveColors = [
  "#628d4e",
  "#b86442",
  "#625aa3",
  "#3f7d8c",
  "#b38b3f",
  "#9a5f78",
] as const;

function createWorkspaceDataset(response: LasImportResponse): WorkspaceDataset {
  const curves: readonly CurveDefinition[] = response.curves.map(
    (curve, index) => ({
      id: curve.id,
      mnemonic: curve.mnemonic,
      description: curve.description || "Imported LAS curve",
      unit: curve.unit,
      color: curveColors[index % curveColors.length] ?? "#1f6f68",
      scale: curve.unit.toLocaleLowerCase().includes("ohm")
        ? "Logarithmic"
        : "Linear",
      minimum: curve.minimum,
      maximum: curve.maximum,
      sampleCount: curve.sample_count,
      nullCount: curve.null_count,
      previewSamples: curve.preview_samples,
    }),
  );

  return {
    id: `las-${response.source_file}-${response.file_size_bytes}`,
    projectName: response.field_name,
    wellName: response.well_name,
    fieldName: response.field_name,
    datasetName: `LAS ${response.las_version} · ${response.curves.length} curves`,
    sourceFile: response.source_file,
    sourceFormat: "LAS",
    lasVersion: response.las_version,
    rowCount: response.row_count,
    depthMnemonic: response.depth_mnemonic,
    depthUnit: response.depth_unit,
    depthMinimum: response.depth_minimum,
    depthMaximum: response.depth_maximum,
    curves,
    warnings: response.warnings,
  };
}

interface LasImportState {
  readonly importing: boolean;
  readonly selectAndImportLas: () => Promise<WorkspaceDataset | null>;
}

export function useLasImport(): LasImportState {
  const [importing, setImporting] = useState(false);

  const selectAndImportLas = useCallback(async () => {
    if (!window.welllogDesktop?.selectLasFile) {
      throw new Error("LAS import is only available in the Electron desktop app.");
    }

    const sourcePath = await window.welllogDesktop.selectLasFile();
    if (!sourcePath) {
      return null;
    }

    setImporting(true);
    try {
      return createWorkspaceDataset(await importLasFromPath(sourcePath));
    } finally {
      setImporting(false);
    }
  }, []);

  return { importing, selectAndImportLas };
}
