import { tableFromIPC, type Table } from "apache-arrow";

export const ARROW_STREAM_CONTENT_TYPE =
  "application/vnd.apache.arrow.stream";

export interface ScalarSample {
  readonly curveId: string;
  readonly index: number;
  readonly value: number | null;
}

export interface VisibleRangeRequest {
  readonly curveIds: readonly string[];
  readonly indexMinimum: number;
  readonly indexMaximum: number;
  readonly viewportHeight: number;
  readonly pointBudget: number;
}

export interface PreviewPageRequest {
  readonly curveIds: readonly string[];
  readonly page: number;
  readonly pageSize?: number;
}

export interface PreviewPage {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, number | string | null>>[];
}

export interface ArrowDataClientOptions {
  readonly baseUrl?: string;
}

export class ArrowDataClient {
  readonly #baseUrl: string;

  constructor(options: ArrowDataClientOptions = {}) {
    this.#baseUrl = (
      options.baseUrl ?? "http://127.0.0.1:8765"
    ).replace(/\/$/, "");
  }

  async visibleRange(
    documentId: string,
    datasetId: string,
    request: VisibleRangeRequest,
    signal?: AbortSignal,
  ): Promise<readonly ScalarSample[]> {
    const table = await this.#postArrow(
      `/api/v1/documents/${encodeURIComponent(documentId)}/datasets/${encodeURIComponent(datasetId)}/scalar/visible-range`,
      {
        curve_ids: request.curveIds,
        index_minimum: request.indexMinimum,
        index_maximum: request.indexMaximum,
        viewport_height: request.viewportHeight,
        point_budget: request.pointBudget,
      },
      signal,
    );
    const curveIds = requiredColumn(table, "curve_id");
    const indexes = requiredColumn(table, "index");
    const values = requiredColumn(table, "value");
    const samples: ScalarSample[] = [];
    for (let row = 0; row < table.numRows; row += 1) {
      const curveId = curveIds.get(row);
      const index = indexes.get(row);
      const value = values.get(row);
      if (typeof curveId !== "string" || typeof index !== "number") {
        continue;
      }
      samples.push({
        curveId,
        index,
        value: typeof value === "number" ? value : null,
      });
    }
    return samples;
  }

  async previewPage(
    documentId: string,
    datasetId: string,
    request: PreviewPageRequest,
    signal?: AbortSignal,
  ): Promise<PreviewPage> {
    const table = await this.#postArrow(
      `/api/v1/documents/${encodeURIComponent(documentId)}/datasets/${encodeURIComponent(datasetId)}/scalar/preview`,
      {
        curve_ids: request.curveIds,
        page: request.page,
        page_size: request.pageSize ?? 100,
      },
      signal,
    );
    const columns = table.schema.fields.map((field) => field.name);
    const rows: Array<Record<string, number | string | null>> = [];
    for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
      const row: Record<string, number | string | null> = {};
      for (const columnName of columns) {
        const value = requiredColumn(table, columnName).get(rowIndex);
        row[columnName] =
          typeof value === "number" || typeof value === "string" ? value : null;
      }
      rows.push(row);
    }
    return { columns, rows };
  }

  async #postArrow(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Table> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });
    if (!response.ok) {
      throw new Error(await responseMessage(response));
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes(ARROW_STREAM_CONTENT_TYPE)) {
      throw new Error("The engine returned an unexpected scalar-data response.");
    }
    return tableFromIPC(new Uint8Array(await response.arrayBuffer()));
  }
}

function requiredColumn(table: Table, name: string) {
  const column = table.getChild(name);
  if (!column) {
    throw new Error(`The Arrow response is missing the ${name} column.`);
  }
  return column;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "detail" in body &&
      typeof body.detail === "string"
    ) {
      return body.detail;
    }
  } catch {
    // The status text is the useful fallback for non-JSON failures.
  }
  return response.statusText || "The scalar-data request failed.";
}

export function chunkCurveIds(
  curveIds: readonly string[],
  batchSize = 16,
): readonly (readonly string[])[] {
  const batches: string[][] = [];
  for (let start = 0; start < curveIds.length; start += batchSize) {
    batches.push(curveIds.slice(start, start + batchSize));
  }
  return batches;
}
