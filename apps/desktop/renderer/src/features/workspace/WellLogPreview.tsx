import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useMemo } from "react";

const fullDepthMinimum = 2300;
const viewWidth = 920;
const viewHeight = 640;
const depthColumnWidth = 80;
const trackWidth = 280;
const plotTop = 70;
const plotBottom = 616;
const plotHeight = plotBottom - plotTop;

interface VisibleDepthRange {
  readonly minimum: number;
  readonly maximum: number;
}

interface CurvePath {
  readonly id: string;
  readonly color: string;
  readonly trackIndex: number;
  readonly path: string;
}

interface WellLogPreviewProps {
  readonly cursorDepth: number;
  readonly selectedCurveId: string;
  readonly visibleRange: VisibleDepthRange;
  readonly onCursorChange: (depth: number) => void;
  readonly onCurveSelect: (curveId: string) => void;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function gammaValue(depth: number): number {
  const position = (depth - fullDepthMinimum) * 2;
  return clamp(
    0.49 +
      Math.sin(position * 0.12) * 0.19 +
      Math.sin(position * 0.031 + 1.7) * 0.13 +
      Math.sin(position * 0.37) * 0.035,
  );
}

function resistivityValue(depth: number): number {
  const position = (depth - fullDepthMinimum) * 2;
  const bedResponse =
    depth > 2330 && depth < 2351
      ? 0.23
      : depth > 2380 && depth < 2393
        ? 0.16
        : 0;

  return clamp(
    0.38 +
      Math.sin(position * 0.075 + 0.8) * 0.12 +
      Math.sin(position * 0.24) * 0.045 +
      bedResponse,
  );
}

function densityValue(depth: number): number {
  const position = (depth - fullDepthMinimum) * 2;
  return clamp(
    0.56 +
      Math.sin(position * 0.095 + 2.3) * 0.12 +
      Math.sin(position * 0.28) * 0.028,
  );
}

function neutronValue(depth: number): number {
  const position = (depth - fullDepthMinimum) * 2;
  const crossover = depth > 2334 && depth < 2346 ? 0.14 : 0;

  return clamp(
    0.48 -
      Math.sin(position * 0.089 + 2.1) * 0.11 -
      Math.sin(position * 0.25) * 0.025 -
      crossover,
  );
}

function depthToY(depth: number, range: VisibleDepthRange): number {
  return (
    plotTop +
    ((depth - range.minimum) / (range.maximum - range.minimum)) * plotHeight
  );
}

function createCurvePath(
  trackIndex: number,
  range: VisibleDepthRange,
  getValue: (depth: number) => number,
): string {
  const trackStart = depthColumnWidth + trackIndex * trackWidth;
  const horizontalPadding = 12;
  const usableWidth = trackWidth - horizontalPadding * 2;
  const pointCount = 240;
  let path = "";

  for (let index = 0; index <= pointCount; index += 1) {
    const depth =
      range.minimum +
      (index / pointCount) * (range.maximum - range.minimum);
    const x = trackStart + horizontalPadding + getValue(depth) * usableWidth;
    const y = depthToY(depth, range);
    path += `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
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
    ticks.push(depth);
    depth += interval;
  }

  return ticks;
}

export function WellLogPreview({
  cursorDepth,
  selectedCurveId,
  visibleRange,
  onCursorChange,
  onCurveSelect,
}: WellLogPreviewProps) {
  const curvePaths = useMemo<readonly CurvePath[]>(
    () => [
      {
        id: "curve-gr",
        color: "#628d4e",
        trackIndex: 0,
        path: createCurvePath(0, visibleRange, gammaValue),
      },
      {
        id: "curve-rt",
        color: "#b86442",
        trackIndex: 1,
        path: createCurvePath(1, visibleRange, resistivityValue),
      },
      {
        id: "curve-rhob",
        color: "#625aa3",
        trackIndex: 2,
        path: createCurvePath(2, visibleRange, densityValue),
      },
      {
        id: "curve-nphi",
        color: "#3f7d8c",
        trackIndex: 2,
        path: createCurvePath(2, visibleRange, neutronValue),
      },
    ],
    [visibleRange],
  );
  const minorDepthTicks = useMemo(
    () => createDepthTicks(visibleRange, 2),
    [visibleRange],
  );
  const majorDepthTicks = useMemo(
    () => createDepthTicks(visibleRange, 10),
    [visibleRange],
  );
  const selectedTrackIndex =
    selectedCurveId === "curve-gr"
      ? 0
      : selectedCurveId === "curve-rt"
        ? 1
        : 2;
  const cursorY = depthToY(cursorDepth, visibleRange);
  const formationTopY = depthToY(2332, visibleRange);
  const formationBaseY = depthToY(2348, visibleRange);
  const visibleFormationTopY = Math.max(plotTop, formationTopY);
  const visibleFormationBaseY = Math.min(plotBottom, formationBaseY);

  function setCursorFromPointer(
    event: ReactPointerEvent<SVGSVGElement>,
  ): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerY =
      ((event.clientY - bounds.top) / bounds.height) * viewHeight;

    if (pointerY < plotTop || pointerY > plotBottom) {
      return;
    }

    const depth =
      visibleRange.minimum +
      ((pointerY - plotTop) / plotHeight) *
        (visibleRange.maximum - visibleRange.minimum);
    onCursorChange(Math.round(depth * 10) / 10);
  }

  function moveCursorWithKeyboard(
    event: ReactKeyboardEvent<SVGSVGElement>,
  ): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    onCursorChange(
      clamp(
        Math.round((cursorDepth + direction * 0.5) * 10) / 10,
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
        Gamma ray, resistivity, density, and neutron curves from 2300 to 2420
        metres measured depth
      </title>

      <rect
        className="plot-background"
        height={plotHeight}
        width={viewWidth}
        x="0"
        y={plotTop}
      />

      {visibleFormationBaseY > visibleFormationTopY ? (
        <rect
          className="formation-band"
          height={visibleFormationBaseY - visibleFormationTopY}
          width={viewWidth - depthColumnWidth}
          x={depthColumnWidth}
          y={visibleFormationTopY}
        />
      ) : null}

      {[0, 1, 2].map((trackIndex) => {
        const x = depthColumnWidth + trackIndex * trackWidth;
        return (
          <g key={trackIndex}>
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
        const isMajor = depth % 10 === 0;
        return (
          <line
            className={isMajor ? "depth-grid-line is-major" : "depth-grid-line"}
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
          MD · m
        </text>

        <text className="curve-title curve-title-gr" x="94" y="27">
          GR
        </text>
        <text className="track-unit" x="94" y="49">
          0
        </text>
        <text className="track-unit track-unit-end" x="346" y="49">
          150 gAPI
        </text>

        <text className="curve-title curve-title-rt" x="374" y="27">
          RT
        </text>
        <text className="track-unit" x="374" y="49">
          0.2
        </text>
        <text className="track-unit track-unit-end" x="626" y="49">
          2,000 Ω·m
        </text>

        <text className="curve-title curve-title-rhob" x="654" y="27">
          RHOB
        </text>
        <text className="curve-title curve-title-nphi" x="718" y="27">
          NPHI
        </text>
        <text className="track-unit" x="654" y="49">
          1.95
        </text>
        <text className="track-unit track-unit-end" x="906" y="49">
          2.95 g/cm³
        </text>
      </g>

      {majorDepthTicks.map((depth) => (
        <text
          className="depth-label"
          key={depth}
          x="12"
          y={depthToY(depth, visibleRange) - 6}
        >
          {depth.toFixed(0)}
        </text>
      ))}

      {formationTopY >= plotTop && formationTopY <= plotBottom ? (
        <g className="formation-top">
          <line
            x1={depthColumnWidth}
            x2={viewWidth}
            y1={formationTopY}
            y2={formationTopY}
          />
          <text x={depthColumnWidth + 10} y={formationTopY - 7}>
            M sand
          </text>
        </g>
      ) : null}

      {curvePaths.map((curve) => (
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
      ))}

      <g className="depth-cursor">
        <line x1="0" x2={viewWidth} y1={cursorY} y2={cursorY} />
        <rect height="24" rx="8" width="66" x="7" y={cursorY - 12} />
        <text x="40" y={cursorY + 4}>
          {cursorDepth.toFixed(1)}
        </text>
      </g>
    </svg>
  );
}
