import {
  createScalarLogRenderer,
  type ScalarLogCurve,
  type ScalarLogRenderModel,
  type ScalarLogRenderer,
} from "@welllog/log-renderer";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";

import type { CurveDefinition } from "./workspaceTypes";
import type { WorkspaceDataset } from "./workspaceTypes";

interface VisibleIndexRange {
  readonly minimum: number;
  readonly maximum: number;
}

interface WellLogChartProps {
  readonly curves: readonly CurveDefinition[];
  readonly dataset: WorkspaceDataset;
  readonly samplesByCurve: ReadonlyMap<
    string,
    readonly { readonly index: number; readonly value: number | null }[]
  >;
  readonly cursorIndex: number;
  readonly fullRange: VisibleIndexRange;
  readonly indexMnemonic: string;
  readonly indexUnit: string;
  readonly selectedCurveId: string;
  readonly visibleRange: VisibleIndexRange;
  readonly onCursorChange: (index: number) => void;
  readonly onCurveSelect: (curveId: string) => void;
  readonly onViewportChange: (range: VisibleIndexRange) => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function WellLogChart({
  curves,
  dataset,
  samplesByCurve,
  cursorIndex,
  fullRange,
  indexMnemonic,
  indexUnit,
  selectedCurveId,
  visibleRange,
  onCursorChange,
  onCurveSelect,
  onViewportChange,
}: WellLogChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ScalarLogRenderer>(null);
  const eventHandlersRef = useRef({
    onCursorChange,
    onCurveSelect,
    onViewportChange,
  });
  eventHandlersRef.current = {
    onCursorChange,
    onCurveSelect,
    onViewportChange,
  };

  const rendererCurves = useMemo<readonly ScalarLogCurve[]>(
    () =>
      curves.map((curve) => ({
        id: curve.id,
        mnemonic: curve.mnemonic,
        unit: curve.unit,
        color: curve.color,
        scale: curve.scale === "Logarithmic" ? "logarithmic" : "linear",
        minimum: curve.minimum,
        maximum: curve.maximum,
        samples: (samplesByCurve.get(curve.id) ?? []).map((sample) => ({
          index: sample.index,
          value: sample.value,
        })),
      })),
    [curves, samplesByCurve],
  );

  const renderModel = useMemo<ScalarLogRenderModel>(
    () => ({
      indexMnemonic,
      indexUnit,
      indexRange: fullRange,
      curves: rendererCurves,
      viewport: visibleRange,
      cursorIndex,
      selectedCurveId,
      indexKind:
        dataset.indexKind === "time"
          ? "time"
          : dataset.indexKind === "other" || dataset.indexKind === "sample"
            ? "other"
            : "depth",
      timeIndexReference: dataset.timeIndexReference,
      timeDisplayMode: dataset.viewSettings.timeDisplayMode,
      timeZone: dataset.viewSettings.timeZone,
      manualAnchorIndex: dataset.viewSettings.manualAnchorIndex,
      manualAnchorTimestamp: dataset.viewSettings.manualAnchorTimestamp,
    }),
    [
      cursorIndex,
      dataset,
      fullRange,
      indexMnemonic,
      indexUnit,
      rendererCurves,
      selectedCurveId,
      visibleRange,
    ],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const renderer = createScalarLogRenderer(element, {
      onCursorChange(index) {
        eventHandlersRef.current.onCursorChange(index);
      },
      onCurveSelect(curveId) {
        eventHandlersRef.current.onCurveSelect(curveId);
      },
      onViewportChange(viewport) {
        eventHandlersRef.current.onViewportChange(viewport);
      },
    });
    rendererRef.current = renderer;

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => renderer.resize());
    resizeObserver?.observe(element);

    return () => {
      resizeObserver?.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    rendererRef.current?.update(renderModel);
  }, [renderModel]);

  function moveCursorWithKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const step = Math.max(
      0.01,
      (visibleRange.maximum - visibleRange.minimum) / 240,
    );
    onCursorChange(
      clamp(
        cursorIndex + direction * step,
        visibleRange.minimum,
        visibleRange.maximum,
      ),
    );
  }

  return (
    <div
      aria-label={`${curves.map((curve) => curve.mnemonic).join(", ")} well-log tracks. Hover for values, use the mouse wheel to zoom, drag to pan, and click to move the shared ${indexMnemonic} cursor.`}
      className="well-log-chart"
      onKeyDown={moveCursorWithKeyboard}
      ref={containerRef}
      role="application"
      style={{ minWidth: `${Math.max(520, 74 + curves.length * 150)}px` }}
      tabIndex={0}
    />
  );
}
