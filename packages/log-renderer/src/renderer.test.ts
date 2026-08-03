import { beforeEach, describe, expect, test, vi } from "vitest";

const echartsMocks = vi.hoisted(() => {
  const chartHandlers = new Map<string, (event: unknown) => void>();
  const canvasHandlers = new Map<string, (event: unknown) => void>();
  const canvasEvents = {
    off: vi.fn((name: string) => canvasHandlers.delete(name)),
    on: vi.fn((name: string, handler: (event: unknown) => void) =>
      canvasHandlers.set(name, handler),
    ),
  };
  const chart = {
    clear: vi.fn(),
    containPixel: vi.fn((finder: { gridIndex: number }) => finder.gridIndex === 1),
    convertFromPixel: vi.fn(() => [12, 234.567]),
    dispose: vi.fn(),
    getZr: vi.fn(() => canvasEvents),
    off: vi.fn((name: string) => chartHandlers.delete(name)),
    on: vi.fn((name: string, handler: (event: unknown) => void) =>
      chartHandlers.set(name, handler),
    ),
    resize: vi.fn(),
    setOption: vi.fn(),
  };
  return {
    canvasEvents,
    canvasHandlers,
    chart,
    chartHandlers,
    init: vi.fn(() => chart),
    use: vi.fn(),
  };
});

vi.mock("echarts/charts", () => ({ LineChart: {} }));
vi.mock("echarts/components", () => ({
  AriaComponent: {},
  AxisPointerComponent: {},
  DataZoomInsideComponent: {},
  GridComponent: {},
  MarkLineComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}));
vi.mock("echarts/core", () => ({
  init: echartsMocks.init,
  use: echartsMocks.use,
}));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

import { createScalarLogRenderer } from "./renderer";
import type { ScalarLogRenderModel } from "./types";

const model: ScalarLogRenderModel = {
  indexMnemonic: "DEPT",
  indexUnit: "m",
  indexRange: { minimum: 0, maximum: 400 },
  cursorIndex: 150,
  selectedCurveId: "gr",
  viewport: { minimum: 100, maximum: 300 },
  curves: [
    {
      id: "gr",
      mnemonic: "GR",
      unit: "gAPI",
      color: "green",
      scale: "linear",
      minimum: 0,
      maximum: 150,
      samples: [{ index: 100, value: 40 }],
    },
    {
      id: "rt",
      mnemonic: "RT",
      unit: "ohm.m",
      color: "red",
      scale: "logarithmic",
      minimum: 0.2,
      maximum: 2_000,
      samples: [{ index: 100, value: 10 }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  echartsMocks.chartHandlers.clear();
  echartsMocks.canvasHandlers.clear();
});

describe("createScalarLogRenderer", () => {
  test("updates, resizes, forwards chart events, and disposes", () => {
    const onCursorChange = vi.fn();
    const onCurveSelect = vi.fn();
    const onViewportChange = vi.fn();
    const element = { clientWidth: 934 } as HTMLElement;
    const renderer = createScalarLogRenderer(element, {
      onCursorChange,
      onCurveSelect,
      onViewportChange,
    });

    renderer.update(model);
    expect(echartsMocks.chart.setOption).toHaveBeenCalledOnce();

    echartsMocks.chartHandlers.get("click")?.({
      seriesId: "rt",
      seriesType: "line",
    });
    expect(onCurveSelect).toHaveBeenCalledWith("rt");

    echartsMocks.canvasHandlers.get("click")?.({ offsetX: 600, offsetY: 300 });
    expect(onCursorChange).toHaveBeenCalledWith(234.57);

    echartsMocks.chartHandlers.get("datazoom")?.({ start: 25, end: 75 });
    expect(onViewportChange).toHaveBeenCalledWith({
      minimum: 100,
      maximum: 300,
    });

    echartsMocks.chartHandlers.get("datazoom")?.({
      batch: [{ startValue: 120, endValue: 220 }],
    });
    expect(onViewportChange).toHaveBeenLastCalledWith({
      minimum: 120,
      maximum: 220,
    });

    renderer.resize();
    expect(echartsMocks.chart.resize).toHaveBeenCalledOnce();
    expect(echartsMocks.chart.setOption).toHaveBeenCalledTimes(2);

    renderer.dispose();
    expect(echartsMocks.chart.dispose).toHaveBeenCalledOnce();
    expect(echartsMocks.chart.off).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
    );
    expect(echartsMocks.chart.off).toHaveBeenCalledWith(
      "datazoom",
      expect.any(Function),
    );
    expect(echartsMocks.canvasEvents.off).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
    );
  });
});
