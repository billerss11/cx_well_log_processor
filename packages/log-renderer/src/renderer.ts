import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  DataZoomInsideComponent,
  GridComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import {
  init,
  use as registerEChartsModules,
  type ECElementEvent,
  type ElementEvent,
} from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import { buildScalarLogOption } from "./options";
import type {
  ScalarLogRenderModel,
  ScalarLogRenderer,
  ScalarLogRendererEvents,
  ScalarLogViewport,
} from "./types";

registerEChartsModules([
  AriaComponent,
  AxisPointerComponent,
  DataZoomInsideComponent,
  GridComponent,
  LineChart,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

function roundIndex(value: number): number {
  return Math.round(value * 100) / 100;
}

interface DataZoomEventRange {
  readonly start?: number;
  readonly end?: number;
  readonly startValue?: unknown;
  readonly endValue?: unknown;
  readonly batch?: readonly DataZoomEventRange[];
}

function clamp(value: number, range: ScalarLogViewport): number {
  return Math.min(range.maximum, Math.max(range.minimum, value));
}

function getViewportFromDataZoom(
  event: DataZoomEventRange,
  indexRange: ScalarLogViewport,
): ScalarLogViewport | undefined {
  const range = event.batch?.[0] ?? event;
  let minimum: number;
  let maximum: number;

  if (
    typeof range.startValue === "number" &&
    typeof range.endValue === "number"
  ) {
    minimum = range.startValue;
    maximum = range.endValue;
  } else if (typeof range.start === "number" && typeof range.end === "number") {
    const fullSpan = indexRange.maximum - indexRange.minimum;
    minimum = indexRange.minimum + (fullSpan * range.start) / 100;
    maximum = indexRange.minimum + (fullSpan * range.end) / 100;
  } else {
    return undefined;
  }

  minimum = clamp(minimum, indexRange);
  maximum = clamp(maximum, indexRange);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    return undefined;
  }
  return { minimum, maximum };
}

export function createScalarLogRenderer(
  element: HTMLElement,
  events: ScalarLogRendererEvents,
): ScalarLogRenderer {
  const chart = init(element, undefined, { renderer: "canvas" });
  const canvasEvents = chart.getZr();
  let model: ScalarLogRenderModel | undefined;

  function render(): void {
    if (!model) {
      chart.clear();
      return;
    }
    chart.setOption(buildScalarLogOption(model, element.clientWidth), {
      notMerge: true,
      lazyUpdate: false,
    });
  }

  function selectCurve(event: ECElementEvent): void {
    if (event.seriesType === "line" && event.seriesId) {
      events.onCurveSelect(event.seriesId);
    }
  }

  function setCursor(event: ElementEvent): void {
    if (!model) {
      return;
    }

    const pixel: [number, number] = [event.offsetX, event.offsetY];
    for (let gridIndex = 0; gridIndex < model.curves.length; gridIndex += 1) {
      if (!chart.containPixel({ gridIndex }, pixel)) {
        continue;
      }
      const coordinate = chart.convertFromPixel({ gridIndex }, pixel);
      if (Array.isArray(coordinate) && Number.isFinite(coordinate[1])) {
        events.onCursorChange(roundIndex(coordinate[1]!));
      }
      return;
    }
  }

  function updateViewport(event: unknown): void {
    if (!model || !event || typeof event !== "object") {
      return;
    }
    const viewport = getViewportFromDataZoom(
      event as DataZoomEventRange,
      model.indexRange,
    );
    if (viewport) {
      events.onViewportChange(viewport);
    }
  }

  chart.on("click", selectCurve);
  chart.on("datazoom", updateViewport);
  canvasEvents.on("click", setCursor);

  return {
    update(nextModel): void {
      model = nextModel;
      render();
    },
    resize(): void {
      chart.resize();
      render();
    },
    dispose(): void {
      chart.off("click", selectCurve);
      chart.off("datazoom", updateViewport);
      canvasEvents.off("click", setCursor);
      chart.dispose();
    },
  };
}
