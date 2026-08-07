import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";

import { LogWorkspace } from "./LogWorkspace";
import type {
  CurveDefinition,
  WorkspaceDataset,
  WorkspaceDocument,
} from "./workspaceTypes";

vi.mock("./WellLogChart", () => ({
  WellLogChart: ({ curves }: { readonly curves: readonly CurveDefinition[] }) => (
    <div aria-label="Rendered curves">
      {curves.map((curve) => curve.mnemonic).join(", ")}
    </div>
  ),
}));

vi.mock("../../hooks/useScalarViewport", () => ({
  useScalarViewport: () => ({
    error: null,
    loading: false,
    samplesByCurve: new Map(),
  }),
}));

vi.mock("../../services/engineApi", () => ({
  getExactCursorValues: vi.fn(),
}));

const curves: readonly CurveDefinition[] = [
  {
    id: "gr",
    mnemonic: "GR",
    description: "Gamma ray",
    unit: "gAPI",
    color: "green",
    scale: "Linear",
    minimum: 20,
    maximum: 120,
    sampleCount: 2,
    nullCount: 0,
    sampleShape: [],
    storageKind: "parquet",
    previewSamples: [
      { depth: 100, value: 40 },
      { depth: 200, value: 80 },
    ],
  },
  {
    id: "rhob",
    mnemonic: "RHOB",
    description: "Bulk density",
    unit: "g/cm3",
    color: "blue",
    scale: "Linear",
    minimum: 1.9,
    maximum: 2.8,
    sampleCount: 2,
    nullCount: 0,
    sampleShape: [],
    storageKind: "parquet",
    previewSamples: [
      { depth: 100, value: 2.2 },
      { depth: 200, value: 2.5 },
    ],
  },
];

const dataset: WorkspaceDataset = {
  id: "dataset-1",
  name: "LAS 2.0",
  kind: "log",
  wellName: "Test Well",
  wellboreName: "Test Wellbore",
  rowCount: 2,
  indexMnemonic: "DEPT",
  indexUnit: "m",
  indexKind: "measured_depth",
  indexMinimum: 100,
  indexMaximum: 200,
  scalarCurveCount: 2,
  timeIndexReference: "none",
  viewSettings: {
    timeDisplayMode: "elapsed",
    timeZone: "utc",
    manualAnchorIndex: null,
    manualAnchorTimestamp: null,
  },
  curves,
};

const document: WorkspaceDocument = {
  id: "document-1",
  sourceFile: "test.las",
  sourceFormat: "LAS",
  sourceVersion: "2.0",
  fieldName: "Test Field",
  fileSizeBytes: 1_024,
  scalarCurveCount: 2,
  saved: false,
  modified: false,
  preservedObjectCount: 1,
  datasets: [dataset],
  warnings: [],
};

afterEach(cleanup);

test("lets the user select, clear, and restore plotted curves", () => {
  const onCurveSelect = vi.fn();
  const onDataPreviewOpen = vi.fn();

  function TestWorkspace() {
    const [visibleCurveIds, setVisibleCurveIds] = useState<readonly string[]>([
      "gr",
      "rhob",
    ]);
    return (
      <LogWorkspace
        dataset={dataset}
        document={document}
        onCurveSelect={onCurveSelect}
        onDataPreviewOpen={onDataPreviewOpen}
        onVisibleCurveIdsChange={setVisibleCurveIds}
        qcIssues={[]}
        qcNavigationTarget={null}
        selectedCurveId="gr"
        visibleCurveIds={visibleCurveIds}
      />
    );
  }
  render(
    <TestWorkspace />,
  );

  expect(screen.getByLabelText("Rendered curves")).toHaveTextContent("GR, RHOB");

  fireEvent.click(
    screen.getByRole("button", { name: /RHOB.*Bulk density.*g\/cm3/i }),
  );
  expect(onCurveSelect).toHaveBeenCalledWith("rhob");

    fireEvent.click(screen.getByRole("button", { name: "Open data table" }));
  expect(onDataPreviewOpen).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByLabelText("Rendered curves")).not.toBeInTheDocument();
  expect(
    screen.getByText("Select one or more curves in the document explorer."),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByLabelText("Rendered curves")).toHaveTextContent("GR, RHOB");
});
