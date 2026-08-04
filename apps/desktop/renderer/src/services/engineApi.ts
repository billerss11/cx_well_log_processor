import {
  client,
  closeDocument,
  exportDatasetCsv,
  getCursorValues,
  getDocument,
  getHealth,
  getJob,
  getMetadataObject,
  listMetadataObjects,
  openDocument,
  saveDocumentAs,
  updateDatasetViewSettings,
  type CursorValueResponse,
  type DatasetViewSettingsUpdate,
  type DocumentSummary,
  type JobStatusResponse,
  type MetadataObjectDetail,
  type MetadataObjectPage,
} from "@welllog/ts-api-client";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765";

client.setConfig({ baseUrl: apiBaseUrl });

export interface IndexCandidate {
  readonly id: string;
  readonly mnemonic: string;
  readonly unit: string;
  readonly kind: string;
  readonly reason: string;
}

export class EngineJobError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly details: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

export class IndexSelectionRequiredError extends EngineJobError {
  constructor(
    message: string,
    readonly candidates: readonly IndexCandidate[],
  ) {
    super(message, "INDEX_SELECTION_REQUIRED", { candidates });
  }
}

export async function getEngineHealth() {
  return getHealth();
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("detail" in error)) {
    return fallback;
  }
  const detail = error.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
    return detail[0].msg;
  }
  return fallback;
}

export async function waitForJob(
  jobId: string,
  onProgress: (job: JobStatusResponse) => void,
): Promise<JobStatusResponse> {
  for (;;) {
    const result = await getJob({ path: { job_id: jobId } });
    if (!result.data) {
      throw new Error(errorMessage(result.error, "Could not read job status."));
    }
    onProgress(result.data);
    if (result.data.state === "COMPLETED") {
      return result.data;
    }
    if (result.data.state === "FAILED" || result.data.state === "CANCELLED") {
      const message = result.data.error ?? result.data.message;
      if (result.data.error_code === "INDEX_SELECTION_REQUIRED") {
        throw new IndexSelectionRequiredError(
          message,
          parseIndexCandidates(result.data.error_details),
        );
      }
      throw new EngineJobError(
        message,
        result.data.error_code ?? null,
        result.data.error_details ?? null,
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
}

export async function openDocumentFromPath(
  sourcePath: string,
  onProgress: (job: JobStatusResponse) => void,
  indexCandidateId?: string,
): Promise<DocumentSummary> {
  const accepted = await openDocument({
    body: {
      index_candidate_id: indexCandidateId,
      max_preview_points: 800,
      source_path: sourcePath,
    },
  });
  if (!accepted.data) {
    throw new Error(errorMessage(accepted.error, "Could not start the open job."));
  }
  const completed = await waitForJob(accepted.data.job_id, onProgress);
  if (!completed.document) {
    throw new Error("The open job completed without a document.");
  }
  return completed.document;
}

export async function saveDocumentToPath(
  documentId: string,
  destinationPath: string,
  onProgress: (job: JobStatusResponse) => void,
): Promise<DocumentSummary> {
  const accepted = await saveDocumentAs({
    body: { destination_path: destinationPath },
    path: { document_id: documentId },
  });
  if (!accepted.data) {
    throw new Error(errorMessage(accepted.error, "Could not start the save job."));
  }
  await waitForJob(accepted.data.job_id, onProgress);
  const refreshed = await getDocument({ path: { document_id: documentId } });
  if (!refreshed.data) {
    throw new Error(errorMessage(refreshed.error, "Could not refresh the document."));
  }
  return refreshed.data;
}

export async function closeDocumentSession(documentId: string): Promise<void> {
  const result = await closeDocument({ path: { document_id: documentId } });
  if (result.error) {
    throw new Error(errorMessage(result.error, "Could not close the document."));
  }
}

export async function getExactCursorValues(
  documentId: string,
  datasetId: string,
  curveIds: readonly string[],
  index: number,
): Promise<CursorValueResponse> {
  const result = await getCursorValues({
    body: { curve_ids: [...curveIds], index },
    path: { dataset_id: datasetId, document_id: documentId },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "Could not look up cursor values."));
  }
  return result.data;
}

export async function updateViewSettings(
  documentId: string,
  datasetId: string,
  settings: DatasetViewSettingsUpdate,
): Promise<DocumentSummary> {
  const result = await updateDatasetViewSettings({
    body: settings,
    path: { dataset_id: datasetId, document_id: documentId },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "Could not save time display settings."));
  }
  return refreshDocument(documentId);
}

export async function getMetadataObjects(
  documentId: string,
  page: number,
  search?: string,
): Promise<MetadataObjectPage> {
  const result = await listMetadataObjects({
    path: { document_id: documentId },
    query: { page, page_size: 50, search },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "Could not list metadata objects."));
  }
  return result.data;
}

export async function getMetadataObjectDetail(
  documentId: string,
  objectId: string,
): Promise<MetadataObjectDetail> {
  const result = await getMetadataObject({
    path: { document_id: documentId, object_id: objectId },
  });
  if (!result.data) {
    throw new Error(errorMessage(result.error, "Could not read metadata details."));
  }
  return result.data;
}

export async function exportCsvToPath(
  documentId: string,
  datasetId: string,
  destinationPath: string,
  curveIds: readonly string[],
  allScalarCurves: boolean,
  onProgress: (job: JobStatusResponse) => void,
): Promise<string> {
  const accepted = await exportDatasetCsv({
    body: {
      all_scalar_curves: allScalarCurves,
      curve_ids: allScalarCurves ? [] : [...curveIds],
      destination_path: destinationPath,
    },
    path: { dataset_id: datasetId, document_id: documentId },
  });
  if (!accepted.data) {
    throw new Error(errorMessage(accepted.error, "Could not start CSV export."));
  }
  const completed = await waitForJob(accepted.data.job_id, onProgress);
  if (!completed.exported_path) {
    throw new Error("The CSV export completed without a destination path.");
  }
  return completed.exported_path;
}

async function refreshDocument(documentId: string): Promise<DocumentSummary> {
  const refreshed = await getDocument({ path: { document_id: documentId } });
  if (!refreshed.data) {
    throw new Error(errorMessage(refreshed.error, "Could not refresh the document."));
  }
  return refreshed.data;
}

function parseIndexCandidates(
  details: Record<string, unknown> | null | undefined,
): readonly IndexCandidate[] {
  const candidates = details?.candidates;
  if (!Array.isArray(candidates)) {
    return [];
  }
  return candidates.flatMap((candidate): IndexCandidate[] => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("id" in candidate) ||
      !("mnemonic" in candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.mnemonic !== "string"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        mnemonic: candidate.mnemonic,
        unit: "unit" in candidate && typeof candidate.unit === "string" ? candidate.unit : "",
        kind: "kind" in candidate && typeof candidate.kind === "string" ? candidate.kind : "other",
        reason:
          "reason" in candidate && typeof candidate.reason === "string"
            ? candidate.reason
            : "Credible monotonic index",
      },
    ];
  });
}
