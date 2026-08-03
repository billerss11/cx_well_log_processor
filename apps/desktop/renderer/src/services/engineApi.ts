import {
  client,
  closeDocument,
  getDocument,
  getHealth,
  getJob,
  openDocument,
  saveDocumentAs,
  type DocumentSummary,
  type JobStatusResponse,
} from "@welllog/ts-api-client";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765";

client.setConfig({ baseUrl: apiBaseUrl });

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

async function waitForJob(
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
      throw new Error(result.data.error ?? result.data.message);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
}

export async function openDocumentFromPath(
  sourcePath: string,
  onProgress: (job: JobStatusResponse) => void,
): Promise<DocumentSummary> {
  const accepted = await openDocument({
    body: { max_preview_points: 800, source_path: sourcePath },
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
