import {
  client,
  getHealth,
  importLas,
  type LasImportResponse,
} from "@welllog/ts-api-client";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765";

client.setConfig({ baseUrl: apiBaseUrl });

export async function getEngineHealth() {
  return getHealth();
}

export async function importLasFromPath(
  sourcePath: string,
): Promise<LasImportResponse> {
  const result = await importLas({
    body: {
      max_preview_points: 800,
      source_path: sourcePath,
    },
  });

  if (result.data) {
    return result.data;
  }

  const detail = result.error?.detail;
  if (typeof detail === "string") {
    throw new Error(detail);
  }
  if (Array.isArray(detail) && detail[0]?.msg) {
    throw new Error(detail[0].msg);
  }
  throw new Error("The local engine could not import this LAS file.");
}
