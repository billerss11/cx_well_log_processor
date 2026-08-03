import type { EChartsCoreOption } from "echarts/core";

import type {
  ScalarLogCurve,
  ScalarLogRenderModel,
  ScalarLogViewport,
} from "./types";

const fallbackWidth = 934;
const depthColumnWidth = 74;
const plotTop = 68;
const plotBottom = 24;

function formatValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const absoluteValue = Math.abs(value);
  if ((absoluteValue > 0 && absoluteValue < 0.01) || absoluteValue >= 10_000) {
    return value.toExponential(2);
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function getTickIntervals(depthSpan: number): {
  readonly major: number;
  readonly minorDivisions: number;
} {
  if (depthSpan <= 30) {
    return { major: 5, minorDivisions: 5 };
  }
  if (depthSpan <= 100) {
    return { major: 10, minorDivisions: 5 };
  }
  if (depthSpan <= 300) {
    return { major: 25, minorDivisions: 5 };
  }
  return { major: 100, minorDivisions: 5 };
}

function getFiniteValues(curve: ScalarLogCurve): number[] {
  const values: number[] = [];
  for (const sample of curve.samples) {
    if (sample.value !== null && Number.isFinite(sample.value)) {
      values.push(sample.value);
    }
  }
  return values;
}

function getLinearExtent(curve: ScalarLogCurve): readonly [number, number] {
  if (
    curve.minimum !== null &&
    curve.maximum !== null &&
    Number.isFinite(curve.minimum) &&
    Number.isFinite(curve.maximum) &&
    curve.maximum > curve.minimum
  ) {
    return [curve.minimum, curve.maximum];
  }

  const values = getFiniteValues(curve);
  if (values.length === 0) {
    return [0, 1];
  }

  let minimum = values[0]!;
  let maximum = values[0]!;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (minimum < maximum) {
    return [minimum, maximum];
  }

  const padding = Math.max(Math.abs(minimum) * 0.01, 1);
  return [minimum - padding, maximum + padding];
}

function getAxisDefinition(curve: ScalarLogCurve): {
  readonly type: "value" | "log";
  readonly minimum: number;
  readonly maximum: number;
} {
  if (
    curve.scale === "logarithmic" &&
    curve.minimum !== null &&
    curve.maximum !== null &&
    curve.minimum > 0 &&
    curve.maximum > curve.minimum
  ) {
    return { type: "log", minimum: curve.minimum, maximum: curve.maximum };
  }

  const [minimum, maximum] = getLinearExtent(curve);
  return { type: "value", minimum, maximum };
}

function clampToViewport(value: number, viewport: ScalarLogViewport): number {
  return Math.min(viewport.maximum, Math.max(viewport.minimum, value));
}

function formatTooltip(params: unknown, model: ScalarLogRenderModel): string {
  const item = Array.isArray(params) ? params[0] : params;
  if (!item || typeof item !== "object") {
    return "";
  }

  const tooltipItem = item as {
    readonly seriesId?: string;
    readonly seriesName?: string;
    readonly value?: unknown;
  };
  if (!Array.isArray(tooltipItem.value)) {
    return tooltipItem.seriesName ?? "";
  }

  const value = tooltipItem.value[0];
  const index = tooltipItem.value[1];
  const curve = model.curves.find((item) => item.id === tooltipItem.seriesId);
  const formattedIndex =
    typeof index === "number" ? formatValue(index) : String(index ?? "—");
  const formattedValue =
    typeof value === "number" ? formatValue(value) : String(value ?? "—");

  return `${model.indexMnemonic} ${formattedIndex} ${model.indexUnit}\n${tooltipItem.seriesName ?? curve?.mnemonic ?? "Curve"} ${formattedValue} ${curve?.unit ?? ""}`.trim();
}

export function buildScalarLogOption(
  model: ScalarLogRenderModel,
  containerWidth: number,
): EChartsCoreOption {
  const width = containerWidth > depthColumnWidth ? containerWidth : fallbackWidth;
  const trackWidth = (width - depthColumnWidth) / model.curves.length;
  const cursorIndex = clampToViewport(model.cursorIndex, model.viewport);
  const intervals = getTickIntervals(model.viewport.maximum - model.viewport.minimum);
  const fullIndexSpan = model.indexRange.maximum - model.indexRange.minimum;

  return {
    animation: false,
    aria: {
      enabled: true,
      description: `${model.curves.map((curve) => curve.mnemonic).join(", ")} curves from ${formatValue(model.viewport.minimum)} to ${formatValue(model.viewport.maximum)} ${model.indexUnit}`,
    },
    axisPointer: {
      link: [{ yAxisIndex: "all" }],
      snap: false,
    },
    backgroundColor: "#fbfcfa",
    dataZoom: [
      {
        id: "index-navigation",
        type: "inside",
        yAxisIndex: model.curves.map((_, index) => index),
        filterMode: "none",
        rangeMode: ["value", "value"],
        startValue: model.viewport.minimum,
        endValue: model.viewport.maximum,
        minValueSpan: Math.max(fullIndexSpan / 100, 0.1),
        realtime: true,
        throttle: 50,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
    ],
    grid: model.curves.map((curve, trackIndex) => ({
      id: `grid:${curve.id}`,
      left: depthColumnWidth + trackIndex * trackWidth,
      width: trackWidth,
      top: plotTop,
      bottom: plotBottom,
      containLabel: false,
      show: true,
      backgroundColor:
        curve.id === model.selectedCurveId ? "rgba(31, 111, 104, 0.028)" : "transparent",
      borderColor:
        curve.id === model.selectedCurveId
          ? "rgba(31, 111, 104, 0.24)"
          : "rgba(37, 71, 67, 0.06)",
      borderWidth: curve.id === model.selectedCurveId ? 1.5 : 1,
    })),
    title: [
      {
        id: "index-title",
        text: model.indexMnemonic.toUpperCase(),
        subtext: model.indexUnit || "index",
        left: 12,
        top: 8,
        textStyle: {
          color: "#586563",
          fontFamily: "Plus Jakarta Sans Variable, Segoe UI Variable, sans-serif",
          fontSize: 9,
          fontWeight: 700,
        },
        subtextStyle: {
          color: "#899391",
          fontFamily: "JetBrains Mono Variable, Cascadia Mono, monospace",
          fontSize: 8,
        },
      },
      ...model.curves.map((curve, trackIndex) => ({
        id: `title:${curve.id}`,
        text: curve.mnemonic,
        subtext: `${formatValue(curve.minimum)} — ${formatValue(curve.maximum)} ${curve.unit}`.trim(),
        left: depthColumnWidth + trackIndex * trackWidth + 12,
        top: 8,
        textStyle: {
          color: curve.color,
          fontFamily: "Plus Jakarta Sans Variable, Segoe UI Variable, sans-serif",
          fontSize: 12,
          fontWeight: 700,
        },
        subtextStyle: {
          color: "#899391",
          fontFamily: "JetBrains Mono Variable, Cascadia Mono, monospace",
          fontSize: 8,
        },
      })),
    ],
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      confine: true,
      backgroundColor: "rgba(36, 53, 51, 0.96)",
      borderColor: "rgba(255, 255, 255, 0.18)",
      borderWidth: 1,
      padding: [7, 9],
      textStyle: {
        color: "#eff8f4",
        fontFamily: "JetBrains Mono Variable, Cascadia Mono, monospace",
        fontSize: 10,
      },
      axisPointer: {
        axis: "y",
        type: "cross",
        snap: false,
        lineStyle: { color: "rgba(38, 60, 58, 0.72)", width: 1 },
        crossStyle: { color: "rgba(38, 60, 58, 0.38)", width: 1 },
        label: {
          color: "#eff8f4",
          backgroundColor: "#46635f",
          precision: 2,
        },
      },
      formatter: (params: unknown) => formatTooltip(params, model),
    },
    xAxis: model.curves.map((curve, trackIndex) => {
      const axis = getAxisDefinition(curve);
      return {
        id: `x-axis:${curve.id}`,
        gridIndex: trackIndex,
        type: axis.type,
        min: axis.minimum,
        max: axis.maximum,
        logBase: axis.type === "log" ? 10 : undefined,
        splitNumber: 4,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: { color: "rgba(50, 79, 74, 0.07)", type: "dashed" },
        },
      };
    }),
    yAxis: model.curves.map((curve, trackIndex) => ({
      id: `y-axis:${curve.id}`,
      gridIndex: trackIndex,
      type: "value",
      inverse: true,
      min: model.indexRange.minimum,
      max: model.indexRange.maximum,
      interval: intervals.major,
      axisLabel: {
        show: trackIndex === 0,
        inside: false,
        margin: trackIndex === 0 ? 12 : 0,
        color: "#727e7c",
        fontFamily: "JetBrains Mono Variable, Cascadia Mono, monospace",
        fontSize: 9,
        formatter: (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: { color: "rgba(50, 79, 74, 0.14)" },
      },
      minorTick: { show: false, splitNumber: intervals.minorDivisions },
      minorSplitLine: {
        show: true,
        lineStyle: { color: "rgba(50, 79, 74, 0.07)" },
      },
    })),
    series: model.curves.map((curve, trackIndex) => {
      const axis = getAxisDefinition(curve);
      const selected = curve.id === model.selectedCurveId;
      return {
        id: curve.id,
        name: curve.mnemonic,
        type: "line",
        xAxisIndex: trackIndex,
        yAxisIndex: trackIndex,
        dimensions: ["value", "index"],
        encode: { x: "value", y: "index" },
        data: curve.samples.map((sample) => [
          axis.type === "log" && sample.value !== null && sample.value <= 0
            ? null
            : sample.value,
          sample.index,
        ]),
        showSymbol: false,
        connectNulls: false,
        sampling: "minmax",
        animation: false,
        clip: true,
        triggerEvent: "line",
        lineStyle: {
          color: curve.color,
          width: selected ? 2.5 : 1.6,
          opacity: selected ? 1 : 0.66,
        },
        emphasis: {
          focus: "series",
          lineStyle: { width: 2.5, opacity: 1 },
        },
        markLine: {
          silent: true,
          animation: false,
          symbol: ["none", "none"],
          lineStyle: { color: "#263c3a", width: 1 },
          label: {
            show: trackIndex === 0,
            formatter: formatValue(cursorIndex),
            position: "insideStartTop",
            color: "#eff8f4",
            backgroundColor: "#243533",
            borderRadius: 6,
            padding: [4, 7],
            fontFamily: "JetBrains Mono Variable, Cascadia Mono, monospace",
            fontSize: 8,
          },
          data: [{ yAxis: cursorIndex }],
        },
      };
    }),
  };
}
