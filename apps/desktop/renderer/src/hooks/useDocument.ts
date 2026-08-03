import type { DocumentSummary, JobStatusResponse } from "@welllog/ts-api-client";
import { useCallback, useState } from "react";

import type {
  CurveDefinition,
  WorkspaceDocument,
} from "../features/workspace/workspaceTypes";
import {
  closeDocumentSession,
  openDocumentFromPath,
  saveDocumentToPath,
} from "../services/engineApi";

const curveColors = [
  "#628d4e",
  "#b86442",
  "#625aa3",
  "#3f7d8c",
  "#b38b3f",
  "#9a5f78",
] as const;

function createWorkspaceDocument(response: DocumentSummary): WorkspaceDocument {
  return {
    id: response.id,
    sourceFile: response.source_file,
    sourceFormat: response.source_format,
    sourceVersion: response.source_version,
    fieldName: response.field_name,
    saved: response.saved,
    preservedObjectCount: response.preserved_object_count,
    warnings: response.warnings,
    datasets: response.datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      kind: dataset.kind,
      wellName: dataset.well_name,
      wellboreName: dataset.wellbore_name,
      rowCount: dataset.row_count,
      indexMnemonic: dataset.index_mnemonic,
      indexUnit: dataset.index_unit,
      indexKind: dataset.index_kind,
      indexMinimum: dataset.index_minimum,
      indexMaximum: dataset.index_maximum,
      curves: dataset.curves.map<CurveDefinition>((curve, index) => ({
        id: curve.id,
        mnemonic: curve.mnemonic,
        description: curve.description || "Imported curve",
        unit: curve.unit,
        color: curveColors[index % curveColors.length] ?? "#1f6f68",
        scale: curve.unit.toLocaleLowerCase().includes("ohm")
          ? "Logarithmic"
          : "Linear",
        minimum: curve.minimum,
        maximum: curve.maximum,
        sampleCount: curve.sample_count,
        nullCount: curve.null_count,
        sampleShape: curve.sample_shape,
        storageKind: curve.storage_kind,
        previewSamples: curve.preview_samples.map((sample) => ({
          depth: sample.index,
          value: sample.value,
        })),
      })),
    })),
  };
}

interface DocumentOperations {
  readonly busy: boolean;
  readonly progress: number;
  readonly statusMessage: string;
  readonly selectAndOpenDocument: () => Promise<WorkspaceDocument | null>;
  readonly selectAndSaveDocument: (
    document: WorkspaceDocument,
  ) => Promise<WorkspaceDocument | null>;
  readonly closeDocument: (documentId: string) => Promise<void>;
}

export function useDocument(): DocumentOperations {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const updateProgress = useCallback((job: JobStatusResponse) => {
    setProgress(job.progress * 100);
    setStatusMessage(job.message);
  }, []);

  const selectAndOpenDocument = useCallback(async () => {
    if (!window.welllogDesktop?.selectWellLogFile) {
      throw new Error("Opening well logs is only available in the desktop app.");
    }
    const sourcePath = await window.welllogDesktop.selectWellLogFile();
    if (!sourcePath) {
      return null;
    }
    setBusy(true);
    setProgress(0);
    setStatusMessage("Opening well log");
    try {
      return createWorkspaceDocument(
        await openDocumentFromPath(sourcePath, updateProgress),
      );
    } finally {
      setBusy(false);
    }
  }, [updateProgress]);

  const selectAndSaveDocument = useCallback(
    async (document: WorkspaceDocument) => {
      if (!window.welllogDesktop?.selectCxlogDestination) {
        throw new Error("Save As is only available in the desktop app.");
      }
      const baseName = document.sourceFile.replace(/\.[^.]+$/, "");
      const destinationPath = await window.welllogDesktop.selectCxlogDestination(
        `${baseName}.cxlog`,
      );
      if (!destinationPath) {
        return null;
      }
      setBusy(true);
      setProgress(0);
      setStatusMessage("Saving CX Log package");
      try {
        return createWorkspaceDocument(
          await saveDocumentToPath(document.id, destinationPath, updateProgress),
        );
      } finally {
        setBusy(false);
      }
    },
    [updateProgress],
  );

  return {
    busy,
    progress,
    statusMessage,
    selectAndOpenDocument,
    selectAndSaveDocument,
    closeDocument: closeDocumentSession,
  };
}
