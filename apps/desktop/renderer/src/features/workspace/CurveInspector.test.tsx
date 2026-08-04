import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CurveInspector } from "./CurveInspector";
import type {
  CurveDefinition,
  WorkspaceDataset,
  WorkspaceDocument,
} from "./workspaceTypes";

const { getMetadataObjectDetail, getMetadataObjects } = vi.hoisted(() => ({
  getMetadataObjectDetail: vi.fn(),
  getMetadataObjects: vi.fn(),
}));

vi.mock("../../services/engineApi", () => ({
  getMetadataObjectDetail,
  getMetadataObjects,
}));

const curve: CurveDefinition = {
  id: "dept",
  mnemonic: "DEPT",
  description: "Bit depth",
  unit: "m",
  color: "green",
  scale: "Linear",
  minimum: 100,
  maximum: 200,
  sampleCount: 2,
  nullCount: 0,
  sampleShape: [],
  storageKind: "parquet",
  previewSamples: [],
};

const dataset: WorkspaceDataset = {
  id: "dataset-1",
  name: "LAS 2.0",
  kind: "log",
  wellName: "Montara H1",
  wellboreName: "Imported wellbore",
  rowCount: 2,
  indexMnemonic: "TIME",
  indexUnit: "s",
  indexKind: "time",
  indexMinimum: 1_000,
  indexMaximum: 2_000,
  scalarCurveCount: 1,
  timeIndexReference: "absolute_utc",
  viewSettings: {
    timeDisplayMode: "clock",
    timeZone: "utc",
    manualAnchorIndex: null,
    manualAnchorTimestamp: null,
  },
  curves: [curve],
};

const workspaceDocument: WorkspaceDocument = {
  id: "document-1",
  sourceFile: "montara.las",
  sourceFormat: "LAS",
  sourceVersion: "2.0",
  fieldName: "Montara",
  fileSizeBytes: 1_024,
  scalarCurveCount: 1,
  saved: false,
  modified: false,
  preservedObjectCount: 1,
  datasets: [dataset],
  warnings: [],
};

beforeEach(() => {
  getMetadataObjects.mockResolvedValue({
    items: [
      {
        id: "las-header",
        name: "Montara H1",
        native_id: "montara.las",
        object_type: "LAS_HEADER",
        parent_native_id: null,
      },
    ],
    page: 0,
    page_size: 50,
    total: 1,
  });
  getMetadataObjectDetail.mockResolvedValue({
    id: "las-header",
    name: "Montara H1",
    native_id: "montara.las",
    object_type: "LAS_HEADER",
    parent_native_id: null,
    metadata_path: "metadata/las/header.json",
    content_type: "application/json",
    content_json: {
      curves: [
        {
          description: "Bit depth",
          mnemonic: "DEPT",
          unit: "M",
          value: "",
        },
      ],
      other: "\n#",
      parameters: [],
      version: [
        {
          description: "CWLS Log ASCII Standard",
          mnemonic: "VERS",
          unit: "",
          value: 2,
        },
      ],
      well: [
        {
          description: "Well name",
          mnemonic: "WELL",
          unit: "",
          value: "Montara H1",
        },
      ],
    },
    size_bytes: 512,
    text: null,
    truncated: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("renders LAS metadata as readable ordered sections instead of raw JSON", async () => {
  const { container } = render(
    <CurveInspector
      busy={false}
      curve={curve}
      dataset={dataset}
      document={workspaceDocument}
      onExport={vi.fn()}
      onViewSettingsSave={vi.fn()}
      visibleCurveIds={[curve.id]}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Metadata" }));
  await waitFor(() => expect(screen.getByText("Montara H1")).toBeInTheDocument());
  fireEvent.click(screen.getByText("Montara H1"));

  await waitFor(() => expect(screen.getByText("VERS")).toBeInTheDocument());
  const metadataDetail = container.querySelector<HTMLElement>(".metadata-detail");
  expect(metadataDetail).not.toBeNull();
  const detail = within(metadataDetail!);
  const sectionLabels = [...container.querySelectorAll(".metadata-section-label > span")]
    .map((element) => element.textContent);
  expect(sectionLabels).toEqual(["Version", "Well", "Curves", "Parameters", "Other"]);
  expect(metadataDetail).not.toHaveTextContent('"mnemonic"');

  fireEvent.click(detail.getByText("Curves"));
  expect(detail.getByText("Bit depth")).toBeInTheDocument();
  expect(detail.getByText("M")).toBeInTheDocument();

  fireEvent.click(detail.getByText("Parameters"));
  expect(detail.getByText("No entries")).toBeInTheDocument();
});
