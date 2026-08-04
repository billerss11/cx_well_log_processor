import type {
  DatasetViewSettingsUpdate,
  DocumentSummary,
  JobStatusResponse,
} from "@welllog/ts-api-client";
import { useCallback, useState } from "react";

import type {
  CurveDefinition,
  WorkspaceDocument,
} from "../features/workspace/workspaceTypes";
import {
  closeDocumentSession,
  exportCsvToPath,
  type IndexCandidate,
  IndexSelectionRequiredError,
  openDocumentFromPath,
  saveDocumentToPath,
  updateViewSettings,
} from "../services/engineApi";

const curveColors = [
  "#628d4e",
  "#b86442",
  "#625aa3",
  "#3f7d8c",
  "#b38b3f",
  "#9a5f78",
] as const;

export function createWorkspaceDocument(response: DocumentSummary): WorkspaceDocument {
  return {
    id: response.id,
    sourceFile: response.source_file,
    sourceFormat: response.source_format,
    sourceVersion: response.source_version,
    fieldName: response.field_name,
    fileSizeBytes: response.file_size_bytes,
    scalarCurveCount: response.scalar_curve_count,
    saved: response.saved,
    modified: response.modified,
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
      scalarCurveCount: dataset.scalar_curve_count,
      timeIndexReference: dataset.time_index_reference ?? "none",
      viewSettings: {
        timeDisplayMode: dataset.view_settings?.time_display_mode ?? "elapsed",
        timeZone: dataset.view_settings?.time_zone ?? "utc",
        manualAnchorIndex: dataset.view_settings?.manual_anchor_index ?? null,
        manualAnchorTimestamp:
          dataset.view_settings?.manual_anchor_timestamp ?? null,
      },
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
  readonly selectAndOpenDocument: (
    selectIndexCandidate: (
      candidates: readonly IndexCandidate[],
    ) => Promise<string | null>,
  ) => Promise<WorkspaceDocument | null>;
  readonly selectAndSaveDocument: (
    document: WorkspaceDocument,
  ) => Promise<WorkspaceDocument | null>;
  readonly closeDocument: (documentId: string) => Promise<void>;
  readonly updateDatasetSettings: (
    documentId: string,
    datasetId: string,
    settings: DatasetViewSettingsUpdate,
  ) => Promise<WorkspaceDocument>;
  readonly selectAndExportCsv: (
    document: WorkspaceDocument,
    datasetId: string,
    curveIds: readonly string[],
    allScalarCurves: boolean,
  ) => Promise<string | null>;
}

export function useDocument(): DocumentOperations {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const updateProgress = useCallback((job: JobStatusResponse) => {
    setProgress(job.progress * 100);
    setStatusMessage(job.message);
  }, []);

  const selectAndOpenDocument = useCallback(async (selectIndexCandidate: (
    candidates: readonly IndexCandidate[],
  ) => Promise<string | null>) => {
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
      try {
        return createWorkspaceDocument(
          await openDocumentFromPath(sourcePath, updateProgress),
        );
      } catch (error) {
        if (!(error instanceof IndexSelectionRequiredError)) {
          throw error;
        }
        const selectedId = await selectIndexCandidate(error.candidates);
        if (!selectedId) {
          return null;
        }
        setProgress(0);
        setStatusMessage("Reopening with selected index");
        return createWorkspaceDocument(
          await openDocumentFromPath(sourcePath, updateProgress, selectedId),
        );
      }
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

  const updateDatasetSettings = useCallback(
    async (
      documentId: string,
      datasetId: string,
      settings: DatasetViewSettingsUpdate,
    ) => {
      setBusy(true);
      setProgress(0);
      setStatusMessage("Saving view settings");
      try {
        return createWorkspaceDocument(
          await updateViewSettings(documentId, datasetId, settings),
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const selectAndExportCsv = useCallback(
    async (
      document: WorkspaceDocument,
      datasetId: string,
      curveIds: readonly string[],
      allScalarCurves: boolean,
    ) => {
      if (!window.welllogDesktop?.selectCsvDestination) {
        throw new Error("CSV export is only available in the desktop app.");
      }
      const baseName = document.sourceFile.replace(/\.[^.]+$/, "");
      const destinationPath = await window.welllogDesktop.selectCsvDestination(
        `${baseName}.csv`,
      );
      if (!destinationPath) {
        return null;
      }
      setBusy(true);
      setProgress(0);
      setStatusMessage("Exporting complete dataset");
      try {
        return await exportCsvToPath(
          document.id,
          datasetId,
          destinationPath,
          curveIds,
          allScalarCurves,
          updateProgress,
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
    selectAndExportCsv,
    updateDatasetSettings,
    closeDocument: closeDocumentSession,
  };
}
