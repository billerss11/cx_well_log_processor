import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App as AntDesignApp } from "antd";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "./App";

const desktopMocks = vi.hoisted(() => ({
  selectCsvDestination: vi.fn<() => Promise<string | null>>(),
  selectCxlogDestination: vi.fn<() => Promise<string | null>>(),
  selectWellLogFile: vi.fn<() => Promise<string | null>>(),
}));

const rendererMocks = vi.hoisted(() => ({
  createScalarLogRenderer: vi.fn(() => ({
    dispose: vi.fn(),
    resize: vi.fn(),
    update: vi.fn(),
  })),
}));

const testData = vi.hoisted(() => ({
  documentSummary: {
    datasets: [
    {
      curves: Array.from({ length: 10 }, (_, index) => ({
        description: index === 0 ? "Gamma Ray" : `Curve ${index + 1}`,
        id: `curve-${index + 1}`,
        maximum: 145.2,
        minimum: 12.4,
        mnemonic: index === 0 ? "GR" : `C${index + 1}`,
        null_count: 3,
        preview_samples: [
          { index: 1750, value: 86.2 },
          { index: 2143, value: 74.1 },
        ],
        sample_count: 3931,
        sample_shape: [],
        storage_kind: "parquet",
        unit: "gAPI",
      })),
      id: "dataset-las-1",
      index_kind: "measured_depth",
      index_maximum: 2143,
      index_minimum: 1750,
      index_mnemonic: "DEPT",
      index_unit: "m",
      kind: "log",
      name: "LAS 2.0",
      row_count: 3931,
      scalar_curve_count: 10,
      time_index_reference: "none",
      view_settings: {
        manual_anchor_index: null,
        manual_anchor_timestamp: null,
        time_display_mode: "elapsed",
        time_zone: "utc",
      },
      well_name: "Geographe 2 L1",
      wellbore_name: "Imported wellbore",
    },
  ],
  field_name: "Geographe",
  file_size_bytes: 2048,
  id: "document-1",
  modified: false,
  preserved_object_count: 1,
  saved: false,
  scalar_curve_count: 10,
  source_file: "test.las",
  source_format: "LAS",
  source_version: "2.0",
    warnings: [],
  } as const,
}));

vi.mock("@welllog/ts-api-client", () => ({
  client: { setConfig: vi.fn() },
  closeDocument: vi.fn().mockResolvedValue({}),
  getDocument: vi.fn().mockResolvedValue({
    data: { ...testData.documentSummary, saved: true },
  }),
  getHealth: vi.fn().mockResolvedValue({
    data: {
      api_version: "v1",
      engine_version: "0.1.0",
      status: "ok",
    },
  }),
  exportDatasetCsv: vi.fn(),
  getCursorValues: vi.fn(),
  getMetadataObject: vi.fn(),
  listMetadataObjects: vi.fn(),
  getJob: vi.fn().mockImplementation(
    (options: { path: { job_id: string } }) =>
      Promise.resolve({
        data:
          options.path.job_id === "open-job"
            ? {
                document: testData.documentSummary,
                id: "open-job",
                message: "Document opened",
                operation: "open_document",
                progress: 1,
                state: "COMPLETED",
              }
            : {
                id: "save-job",
                message: "CX Log package saved",
                operation: "save_document",
                progress: 1,
                saved_path: "J:\\sample\\test.cxlog",
                state: "COMPLETED",
              },
      }),
  ),
  openDocument: vi.fn().mockResolvedValue({ data: { job_id: "open-job" } }),
  saveDocumentAs: vi
    .fn()
    .mockResolvedValue({ data: { job_id: "save-job" } }),
  updateDatasetViewSettings: vi.fn(),
}));

vi.mock("@welllog/log-renderer", () => ({
  createScalarLogRenderer: rendererMocks.createScalarLogRenderer,
}));

beforeEach(() => {
  desktopMocks.selectWellLogFile.mockResolvedValue("J:\\sample\\test.las");
  desktopMocks.selectCxlogDestination.mockResolvedValue(
    "J:\\sample\\test.cxlog",
  );
  desktopMocks.selectCsvDestination.mockResolvedValue("J:\\sample\\test.csv");
  Object.defineProperty(window, "welllogDesktop", {
    configurable: true,
    value: {
      platform: "win32",
      selectCsvDestination: desktopMocks.selectCsvDestination,
      selectCxlogDestination: desktopMocks.selectCxlogDestination,
      selectWellLogFile: desktopMocks.selectWellLogFile,
      versions: { electron: "43.2.0" },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <AntDesignApp>
      <App />
    </AntDesignApp>,
  );
}

test("starts empty and shows the shared engine version", async () => {
  renderApp();

  expect(
    screen.getByRole("heading", { name: "CX Well Log Processor" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("No document open").length).toBeGreaterThan(0);
  expect(await screen.findByText("Engine 0.1.0 · API v1")).toBeInTheDocument();
});

test("opens a selected well-log file into the workspace", async () => {
  renderApp();

  fireEvent.click(screen.getAllByRole("button", { name: /Open Well Log/i })[0]!);

  expect(
    await screen.findByRole("heading", { name: "Geographe 2 L1" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("test.las").length).toBeGreaterThan(0);
  expect(desktopMocks.selectWellLogFile).toHaveBeenCalledOnce();
});

test("shows eight curves by default and allows more without a cap", async () => {
  renderApp();
  fireEvent.click(screen.getAllByRole("button", { name: /Open Well Log/i })[0]!);
  const visibleCurves = await screen.findByLabelText("Visible curves");
  expect(within(visibleCurves).getAllByRole("button")).toHaveLength(8);

  fireEvent.click(screen.getByRole("checkbox", { name: /Show C9, Curve 9, gAPI/i }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Show C10, Curve 10, gAPI/i }));
  expect(within(visibleCurves).getAllByRole("button")).toHaveLength(10);
});

test("saves the open document as a CX Log package", async () => {
  renderApp();
  fireEvent.click(screen.getAllByRole("button", { name: /Open Well Log/i })[0]!);
  await screen.findByRole("heading", { name: "Geographe 2 L1" });

  fireEvent.click(screen.getByRole("button", { name: /Save As/i }));

  expect(await screen.findByText("LAS · 1 datasets · saved")).toBeInTheDocument();
  expect(desktopMocks.selectCxlogDestination).toHaveBeenCalledWith("test.cxlog");
});
