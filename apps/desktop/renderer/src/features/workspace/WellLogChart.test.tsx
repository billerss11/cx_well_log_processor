import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const rendererMocks = vi.hoisted(() => {
  const renderer = {
    dispose: vi.fn(),
    resize: vi.fn(),
    update: vi.fn(),
  };
  return {
    createScalarLogRenderer: vi.fn(
      (
        element: HTMLElement,
        events: {
          readonly onCursorChange: (index: number) => void;
          readonly onCurveSelect: (curveId: string) => void;
          readonly onViewportChange: (range: {
            readonly minimum: number;
            readonly maximum: number;
          }) => void;
        },
      ) => {
        void element;
        void events;
        return renderer;
      },
    ),
    renderer,
  };
});

vi.mock("@welllog/log-renderer", () => ({
  createScalarLogRenderer: rendererMocks.createScalarLogRenderer,
}));

import { WellLogChart } from "./WellLogChart";
import type { CurveDefinition, WorkspaceDataset } from "./workspaceTypes";

const curve: CurveDefinition = {
  id: "gr",
  mnemonic: "GR",
  description: "Gamma ray",
  unit: "gAPI",
  color: "green",
  scale: "Linear",
  minimum: 0,
  maximum: 150,
  sampleCount: 2,
  nullCount: 0,
  sampleShape: [],
  storageKind: "parquet",
  previewSamples: [
    { depth: 100, value: 40 },
    { depth: 200, value: 80 },
  ],
};

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
  scalarCurveCount: 1,
  timeIndexReference: "none",
  viewSettings: {
    timeDisplayMode: "elapsed",
    timeZone: "utc",
    manualAnchorIndex: null,
    manualAnchorTimestamp: null,
  },
  curves: [curve],
};

const samplesByCurve = new Map([
  ["gr", [{ curveId: "gr", index: 100, value: 40 }, { curveId: "gr", index: 200, value: 80 }]],
]);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("updates the renderer and preserves keyboard cursor movement", () => {
  const onCursorChange = vi.fn();
  const { unmount } = render(
    <WellLogChart
      curves={[curve]}
      dataset={dataset}
      cursorIndex={150}
      fullRange={{ minimum: 100, maximum: 200 }}
      indexMnemonic="DEPT"
      indexUnit="m"
      samplesByCurve={samplesByCurve}
      onCursorChange={onCursorChange}
      onCurveSelect={vi.fn()}
      onViewportChange={vi.fn()}
      selectedCurveId="gr"
      visibleRange={{ minimum: 100, maximum: 200 }}
    />,
  );

  expect(rendererMocks.createScalarLogRenderer).toHaveBeenCalledOnce();
  expect(rendererMocks.renderer.update).toHaveBeenCalledWith(
    expect.objectContaining({
      cursorIndex: 150,
      indexMnemonic: "DEPT",
      selectedCurveId: "gr",
    }),
  );

  fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowDown" });
  expect(onCursorChange).toHaveBeenCalledWith(150 + 100 / 240);

  unmount();
  expect(rendererMocks.renderer.dispose).toHaveBeenCalledOnce();
});

test("forwards renderer interactions to the latest callbacks", () => {
  const firstCursorChange = vi.fn();
  const firstViewportChange = vi.fn();
  const latestCursorChange = vi.fn();
  const latestCurveSelect = vi.fn();
  const latestViewportChange = vi.fn();
  const { rerender } = render(
    <WellLogChart
      curves={[curve]}
      dataset={dataset}
      cursorIndex={150}
      fullRange={{ minimum: 100, maximum: 200 }}
      indexMnemonic="DEPT"
      indexUnit="m"
      samplesByCurve={samplesByCurve}
      onCursorChange={firstCursorChange}
      onCurveSelect={vi.fn()}
      onViewportChange={firstViewportChange}
      selectedCurveId="gr"
      visibleRange={{ minimum: 100, maximum: 200 }}
    />,
  );
  rerender(
    <WellLogChart
      curves={[curve]}
      dataset={dataset}
      cursorIndex={150}
      fullRange={{ minimum: 100, maximum: 200 }}
      indexMnemonic="DEPT"
      indexUnit="m"
      samplesByCurve={samplesByCurve}
      onCursorChange={latestCursorChange}
      onCurveSelect={latestCurveSelect}
      onViewportChange={latestViewportChange}
      selectedCurveId="gr"
      visibleRange={{ minimum: 100, maximum: 200 }}
    />,
  );

  const events = rendererMocks.createScalarLogRenderer.mock.calls[0]?.[1];
  events?.onCursorChange(175);
  events?.onCurveSelect("gr");
  events?.onViewportChange({ minimum: 125, maximum: 175 });

  expect(firstCursorChange).not.toHaveBeenCalled();
  expect(firstViewportChange).not.toHaveBeenCalled();
  expect(latestCursorChange).toHaveBeenCalledWith(175);
  expect(latestCurveSelect).toHaveBeenCalledWith("gr");
  expect(latestViewportChange).toHaveBeenCalledWith({
    minimum: 125,
    maximum: 175,
  });
});
