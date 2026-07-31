import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useMemo } from "react";

import {
  formatCurveValue,
  type CurveDefinition,
} from "./workspaceTypes";

const viewWidth = 934;
const viewHeight = 760;
const depthColumnWidth = 74;
const plotTop = 68;
const plotBottom = 736;
const plotHeight = plotBottom - plotTop;

interface VisibleDepthRange {
  readonly minimum: number;
  readonly maximum: number;
}

interface CurvePath {
  readonly id: string;
  readonly color: string;
  readonly path: string;
}

interface WellLogPreviewProps {
  readonly curves: readonly CurveDefinition[];
  readonly cursorDepth: number;
  readonly depthUnit: string;
  readonly selectedCurveId: string;
  readonly visibleRange: VisibleDepthRange;
  readonly onCursorChange: (depth: number) => void;
  readonly onCurveSelect: (curveId: string) => void;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function depthToY(depth: number, range: VisibleDepthRange): number {
  return (
    plotTop +
    ((depth - range.minimum) / (range.maximum - range.minimum)) * plotHeight
  );
}

function valueToRatio(curve: CurveDefinition, value: number): number {
  const minimum = curve.minimum;
  const maximum = curve.maximum;
  if (minimum === null || maximum === null || minimum === maximum) {
    return 0.5;
  }

  if (
    curve.scale === "Logarithmic" &&
    minimum > 0 &&
    maximum > minimum &&
    value > 0
  ) {
    return clamp(
      (Math.log10(value) - Math.log10(minimum)) /
        (Math.log10(maximum) - Math.log10(minimum)),
    );
  }

  return clamp((value - minimum) / (maximum - minimum));
}

function createCurvePath(
  curve: CurveDefinition,
  trackIndex: number,
  trackWidth: number,
  range: VisibleDepthRange,
): string {
  const trackStart = depthColumnWidth + trackIndex * trackWidth;
  const horizontalPadding = Math.min(12, trackWidth * 0.08);
  const usableWidth = trackWidth - horizontalPadding * 2;
  let path = "";
  let drawing = false;

  for (const sample of curve.previewSamples) {
    if (sample.depth < range.minimum || sample.depth > range.maximum) {
      continue;
    }
    if (sample.value === null) {
      drawing = false;
      continue;
    }

    const x =
      trackStart +
      horizontalPadding +
      valueToRatio(curve, sample.value) * usableWidth;
    const y = depthToY(sample.depth, range);
    path += `${drawing ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    drawing = true;
  }

  return path.trim();
}

function createDepthTicks(
  range: VisibleDepthRange,
  interval: number,
): number[] {
  const ticks: number[] = [];
  let depth = Math.ceil(range.minimum / interval) * interval;

  while (depth <= range.maximum) {
    ticks.push(Number(depth.toFixed(6)));
    depth += interval;
  }

  return ticks;
}

function getTickIntervals(depthSpan: number): {
  readonly major: number;
  readonly minor: number;
} {
  if (depthSpan <= 30) {
    return { major: 5, minor: 1 };
  }
  if (depthSpan <= 100) {
    return { major: 10, minor: 2 };
  }
  if (depthSpan <= 300) {
    return { major: 25, minor: 5 };
  }
  return { major: 100, minor: 20 };
}

export function WellLogPreview({
  curves,
  cursorDepth,
  depthUnit,
  selectedCurveId,
  visibleRange,
  onCursorChange,
  onCurveSelect,
}: WellLogPreviewProps) {
  const trackWidth = (viewWidth - depthColumnWidth) / curves.length;
  const intervals = getTickIntervals(
    visibleRange.maximum - visibleRange.minimum,
  );
  const curvePaths = useMemo<readonly CurvePath[]>(
    () =>
      curves.map((curve, trackIndex) => ({
        id: curve.id,
        color: curve.color,
        path: createCurvePath(curve, trackIndex, trackWidth, visibleRange),
      })),
    [curves, trackWidth, visibleRange],
  );
  const minorDepthTicks = useMemo(
    () => createDepthTicks(visibleRange, intervals.minor),
    [intervals.minor, visibleRange],
  );
  const majorDepthTicks = useMemo(
    () => createDepthTicks(visibleRange, intervals.major),
    [intervals.major, visibleRange],
  );
  const selectedTrackIndex = Math.max(
    0,
    curves.findIndex((curve) => curve.id === selectedCurveId),
  );
  const cursorY = depthToY(cursorDepth, visibleRange);

  function setCursorFromPointer(
    event: ReactPointerEvent<SVGSVGElement>,
  ): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerY = ((event.clientY - bounds.top) / bounds.height) * viewHeight;

    if (pointerY < plotTop || pointerY > plotBottom) {
      return;
    }

    const depth =
      visibleRange.minimum +
      ((pointerY - plotTop) / plotHeight) *
        (visibleRange.maximum - visibleRange.minimum);
    onCursorChange(Math.round(depth * 100) / 100);
  }

  function moveCursorWithKeyboard(
    event: ReactKeyboardEvent<SVGSVGElement>,
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
        cursorDepth + direction * step,
        visibleRange.minimum,
        visibleRange.maximum,
      ),
    );
  }

  return (
    <svg
      aria-label="Well log preview. Click to move the shared depth cursor."
      className="well-log-svg"
      onKeyDown={moveCursorWithKeyboard}
      onPointerDown={setCursorFromPointer}
      role="img"
      tabIndex={0}
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
    >
      <title>
        {curves.map((curve) => curve.mnemonic).join(", ")} curves from{" "}
        {visibleRange.minimum.toFixed(1)} to {visibleRange.maximum.toFixed(1)}{" "}
        {depthUnit}
      </title>

      <rect
        className="plot-background"
        height={plotHeight}
        width={viewWidth}
        x="0"
        y={plotTop}
      />

      {curves.map((curve, trackIndex) => {
        const x = depthColumnWidth + trackIndex * trackWidth;
        return (
          <g key={curve.id}>
            <rect
              className={
                selectedTrackIndex === trackIndex
                  ? "track-selection is-selected"
                  : "track-selection"
              }
              height={plotHeight}
              width={trackWidth}
              x={x}
              y={plotTop}
            />
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                className="track-grid-line"
                key={ratio}
                x1={x + ratio * trackWidth}
                x2={x + ratio * trackWidth}
                y1={plotTop}
                y2={plotBottom}
              />
            ))}
          </g>
        );
      })}

      {minorDepthTicks.map((depth) => {
        const y = depthToY(depth, visibleRange);
        const isMajor =
          Math.abs(depth / intervals.major - Math.round(depth / intervals.major)) <
          0.000_001;
        return (
          <line
            className={
              isMajor ? "depth-grid-line is-major" : "depth-grid-line"
            }
            key={depth}
            x1="0"
            x2={viewWidth}
            y1={y}
            y2={y}
          />
        );
      })}

      <g className="track-header">
        <text className="depth-title" x="12" y="27">
          DEPTH
        </text>
        <text className="track-unit" x="12" y="49">
          MD · {depthUnit || "index"}
        </text>

        {curves.map((curve, trackIndex) => {
          const x = depthColumnWidth + trackIndex * trackWidth;
          return (
            <g key={curve.id}>
              <text
                className="curve-title"
                fill={curve.color}
                x={x + 14}
                y="27"
              >
                {curve.mnemonic}
              </text>
              <text className="track-unit" x={x + 14} y="49">
                {formatCurveValue(curve.minimum)}
              </text>
              <text
                className="track-unit track-unit-end"
                x={x + trackWidth - 14}
                y="49"
              >
                {formatCurveValue(curve.maximum)} {curve.unit}
              </text>
            </g>
          );
        })}
      </g>

      {majorDepthTicks.map((depth) => (
        <text
          className="depth-label"
          key={depth}
          x="12"
          y={depthToY(depth, visibleRange) - 6}
        >
          {depth.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </text>
      ))}

      {curvePaths.map((curve) =>
        curve.path ? (
          <g key={curve.id}>
            <path
              className={
                selectedCurveId === curve.id
                  ? "curve-path is-selected"
                  : "curve-path"
              }
              d={curve.path}
              stroke={curve.color}
            />
            <path
              className="curve-hit-target"
              d={curve.path}
              onPointerDown={(event) => {
                event.stopPropagation();
                onCurveSelect(curve.id);
              }}
              stroke="transparent"
            />
          </g>
        ) : null,
      )}

      <g className="depth-cursor">
        <line x1="0" x2={viewWidth} y1={cursorY} y2={cursorY} />
        <rect height="24" rx="8" width="66" x="7" y={cursorY - 12} />
        <text x="40" y={cursorY + 4}>
          {cursorDepth.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </text>
      </g>
    </svg>
  );
}
