import { describe, expect, test } from "vitest";

import { buildScalarLogOption } from "./options";
import type { ScalarLogRenderModel } from "./types";

interface AxisOption {
  readonly type: string;
  readonly inverse?: boolean;
  readonly min: number;
  readonly max: number;
}

interface IndexAxisOption extends AxisOption {
  readonly interval: number;
  readonly axisLabel: { readonly formatter: (value: number) => string };
  readonly axisPointer: {
    readonly label: {
      readonly show: boolean;
      readonly formatter: (params: unknown) => string;
    };
  };
}

interface SeriesOption {
  readonly id: string;
  readonly connectNulls: boolean;
  readonly sampling?: string;
  readonly data: readonly (readonly [number | null, number])[];
  readonly lineStyle: { readonly width: number; readonly opacity: number };
  readonly markLine: { readonly data: readonly [{ readonly yAxis: number }] };
}

interface DataZoomOption {
  readonly type: string;
  readonly yAxisIndex: readonly number[];
  readonly startValue: number;
  readonly endValue: number;
  readonly zoomOnMouseWheel: boolean;
  readonly moveOnMouseMove: boolean;
}

interface TooltipOption {
  readonly trigger: string;
  readonly axisPointer: {
    readonly axis: string;
    readonly type: string;
    readonly label: { readonly show: boolean };
  };
  readonly formatter: (params: unknown) => string;
}

function createModel(): ScalarLogRenderModel {
  return {
    indexMnemonic: "DEPT",
    indexUnit: "m",
    indexRange: { minimum: 0, maximum: 300 },
    cursorIndex: 150,
    indexKind: "depth",
    timeIndexReference: "none",
    timeDisplayMode: "elapsed",
    timeZone: "utc",
    manualAnchorIndex: null,
    manualAnchorTimestamp: null,
    selectedCurveId: "gr",
    viewport: { minimum: 100, maximum: 200 },
    curves: [
      {
        id: "gr",
        mnemonic: "GR",
        unit: "gAPI",
        color: "#628d4e",
        scale: "linear",
        minimum: 0,
        maximum: 150,
        samples: [
          { index: 100, value: 40 },
          { index: 110, value: null },
        ],
      },
      {
        id: "rt",
        mnemonic: "RT",
        unit: "ohm.m",
        color: "#b86442",
        scale: "logarithmic",
        minimum: 0.2,
        maximum: 2_000,
        samples: [
          { index: 100, value: 10 },
          { index: 110, value: -1 },
        ],
      },
    ],
  };
}

describe("buildScalarLogOption", () => {
  test("builds synchronized side-by-side scalar tracks", () => {
    const option = buildScalarLogOption(createModel(), 934);
    const grids = option.grid as readonly object[];
    const xAxes = option.xAxis as readonly AxisOption[];
    const yAxes = option.yAxis as readonly AxisOption[];
    const series = option.series as readonly SeriesOption[];

    expect(grids).toHaveLength(2);
    expect(xAxes.map((axis) => axis.type)).toEqual(["value", "log"]);
    expect(yAxes).toHaveLength(2);
    expect(yAxes.every((axis) => axis.inverse)).toBe(true);
    expect(yAxes.every((axis) => axis.min === 0 && axis.max === 300)).toBe(
      true,
    );
    expect(series).toHaveLength(2);
    expect(series.every((item) => item.connectNulls === false)).toBe(true);
    expect(series.every((item) => item.sampling === undefined)).toBe(true);
    expect(series[0]?.lineStyle).toEqual({
      color: "#628d4e",
      opacity: 1,
      width: 2.5,
    });
    expect(series[1]?.lineStyle.opacity).toBe(0.66);
    expect(series[0]?.markLine.data[0].yAxis).toBe(150);
  });

  test("formats absolute time indexes as clock time", () => {
    const model = createModel();
    const timeSpan = 3 * 24 * 60 * 60;
    const timeModel: ScalarLogRenderModel = {
      ...model,
      indexKind: "time",
      indexRange: { minimum: 1_800_000_000, maximum: 1_800_000_000 + timeSpan },
      timeDisplayMode: "clock",
      timeIndexReference: "absolute_utc",
      viewport: { minimum: 1_800_000_000, maximum: 1_800_000_000 + timeSpan },
    };

    const option = buildScalarLogOption(timeModel, 934);
    const yAxes = option.yAxis as readonly IndexAxisOption[];
    const firstAxis = yAxes[0]!;

    expect(timeSpan / firstAxis.interval).toBeLessThanOrEqual(12);
    expect(firstAxis.axisLabel.formatter(1_800_000_000)).toMatch(
      /\d{2} [A-Z][a-z]{2}\n\d{2}:\d{2}/,
    );
    expect(firstAxis.axisPointer.label.show).toBe(true);
    expect(yAxes[1]?.axisPointer.label.show).toBe(false);
    expect(
      firstAxis.axisPointer.label.formatter({ value: 1_800_000_000 }),
    ).not.toContain("1,800,000,000");
  });

  test("enables linked hover and synchronized inside navigation", () => {
    const option = buildScalarLogOption(createModel(), 934);
    const dataZoom = (option.dataZoom as readonly DataZoomOption[])[0];
    const tooltip = option.tooltip as TooltipOption;
    const axisPointer = option.axisPointer as {
      readonly link: readonly [{ readonly yAxisIndex: string }];
    };

    expect(dataZoom).toMatchObject({
      type: "inside",
      yAxisIndex: [0, 1],
      startValue: 100,
      endValue: 200,
      zoomOnMouseWheel: true,
      moveOnMouseMove: true,
    });
    expect(axisPointer.link[0].yAxisIndex).toBe("all");
    expect(tooltip.trigger).toBe("axis");
    expect(tooltip.axisPointer).toMatchObject({
      axis: "y",
      type: "line",
      label: { show: false },
    });
    expect(
      tooltip.formatter({
        seriesId: "gr",
        seriesName: "GR",
        value: [40, 150],
      }),
    ).toBe("DEPT 150 m\nGR 40 gAPI");
  });

  test("keeps nulls and invalid logarithmic values as gaps", () => {
    const option = buildScalarLogOption(createModel(), 934);
    const series = option.series as readonly SeriesOption[];

    expect(series[0]?.data[1]).toEqual([null, 110]);
    expect(series[1]?.data[1]).toEqual([null, 110]);
  });

  test("falls back to safe linear bounds when logarithmic bounds are invalid", () => {
    const model = createModel();
    const option = buildScalarLogOption(
      {
        ...model,
        curves: [
          {
            ...model.curves[1]!,
            minimum: null,
            maximum: null,
            samples: [{ index: 100, value: 7 }],
          },
        ],
      },
      934,
    );
    const xAxis = (option.xAxis as readonly AxisOption[])[0];

    expect(xAxis?.type).toBe("value");
    expect(xAxis?.min).toBeLessThan(7);
    expect(xAxis?.max).toBeGreaterThan(7);
  });
});
