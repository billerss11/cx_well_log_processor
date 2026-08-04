import AimOutlined from "@ant-design/icons/AimOutlined";
import CompressOutlined from "@ant-design/icons/CompressOutlined";
import ZoomInOutlined from "@ant-design/icons/ZoomInOutlined";
import ZoomOutOutlined from "@ant-design/icons/ZoomOutOutlined";
import { chunkCurveIds } from "@welllog/arrow-data-client";
import { Alert, Button, Spin, Tag, Tooltip, Typography } from "antd";
import { useLayoutEffect, useRef, useState } from "react";

import { useScalarViewport } from "../../hooks/useScalarViewport";
import { getExactCursorValues } from "../../services/engineApi";
import { WellLogChart } from "./WellLogChart";
import {
  findCurve,
  formatCurveValue,
  isDisplayableCurve,
  type WorkspaceDataset,
  type WorkspaceDocument,
} from "./workspaceTypes";

const displayLocale = "en-GB";

interface IndexRange {
  readonly minimum: number;
  readonly maximum: number;
}

interface ExactCursorValue {
  readonly value: number | null;
  readonly status: "exact" | "interpolated" | "nearest" | "no_data";
}

interface LogWorkspaceProps {
  readonly dataset: WorkspaceDataset;
  readonly document: WorkspaceDocument;
  readonly selectedCurveId: string;
  readonly visibleCurveIds: readonly string[];
  readonly onCurveSelect: (curveId: string) => void;
  readonly onVisibleCurveIdsChange: (curveIds: readonly string[]) => void;
}

export function LogWorkspace({
  dataset,
  document,
  selectedCurveId,
  visibleCurveIds,
  onCurveSelect,
  onVisibleCurveIdsChange,
}: LogWorkspaceProps) {
  const fullIndexMinimum = dataset.indexMinimum ?? 0;
  const fullIndexMaximum = dataset.indexMaximum ?? Math.max(dataset.rowCount - 1, 1);
  const fullIndexSpan = fullIndexMaximum - fullIndexMinimum;
  const minimumIndexSpan = Math.max(fullIndexSpan / 100, 0.1);
  const [cursorIndex, setCursorIndex] = useState(
    () => fullIndexMinimum + fullIndexSpan / 2,
  );
  const [visibleRange, setVisibleRange] = useState<IndexRange>({
    minimum: fullIndexMinimum,
    maximum: fullIndexMaximum,
  });
  const [viewportHeight, setViewportHeight] = useState(600);
  const [exactCursorValues, setExactCursorValues] = useState<
    ReadonlyMap<string, ExactCursorValue>
  >(() => new Map());
  const [cursorLookupLoading, setCursorLookupLoading] = useState(false);
  const instrumentRef = useRef<HTMLDivElement>(null);
  const cursorRequest = useRef(0);

  const displayableCurves = dataset.curves.filter(isDisplayableCurve);
  const selectedCurve = findCurve(displayableCurves, selectedCurveId);
  const displayedCurves = displayableCurves.filter((curve) =>
    visibleCurveIds.includes(curve.id),
  );
  const viewport = useScalarViewport(
    document.id,
    dataset.id,
    displayedCurves.map((curve) => curve.id),
    visibleRange,
    viewportHeight,
  );
  const exactCursorValue = exactCursorValues.get(selectedCurve.id);
  const localCursorValue = findNearestLoadedValue(
    viewport.samplesByCurve.get(selectedCurve.id) ?? [],
    cursorIndex,
  );
  const cursorValue = exactCursorValue?.value ?? localCursorValue;

  useLayoutEffect(() => {
    const element = instrumentRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setViewportHeight(Math.max(100, element.clientHeight));
    });
    observer.observe(element);
    setViewportHeight(Math.max(100, element.clientHeight));
    return () => observer.disconnect();
  }, []);

  function setIndexSpan(nextSpan: number): void {
    const boundedSpan = Math.min(
      fullIndexMaximum - fullIndexMinimum,
      Math.max(minimumIndexSpan, nextSpan),
    );
    let minimum = cursorIndex - boundedSpan / 2;
    let maximum = cursorIndex + boundedSpan / 2;
    if (minimum < fullIndexMinimum) {
      minimum = fullIndexMinimum;
      maximum = fullIndexMinimum + boundedSpan;
    }
    if (maximum > fullIndexMaximum) {
      maximum = fullIndexMaximum;
      minimum = fullIndexMaximum - boundedSpan;
    }
    setVisibleRange({ minimum, maximum });
  }

  function lockCursor(nextIndex: number): void {
    setCursorIndex(nextIndex);
    setExactCursorValues(new Map());
    if (displayedCurves.length === 0) {
      return;
    }
    const requestId = cursorRequest.current + 1;
    cursorRequest.current = requestId;
    setCursorLookupLoading(true);
    const curveBatches = chunkCurveIds(
      displayedCurves.map((curve) => curve.id),
      64,
    );
    void Promise.all(
      curveBatches.map((curveIds) =>
        getExactCursorValues(
          document.id,
          dataset.id,
          curveIds,
          nextIndex,
        ),
      ),
    )
      .then((responses) => {
        if (requestId !== cursorRequest.current) {
          return;
        }
        setExactCursorValues(
          new Map(
            responses.flatMap((response) => response.values).map((item) => [
              item.curve_id,
              { status: item.status, value: item.value },
            ]),
          ),
        );
      })
      .catch(() => {
        if (requestId === cursorRequest.current) {
          setExactCursorValues(new Map());
        }
      })
      .finally(() => {
        if (requestId === cursorRequest.current) {
          setCursorLookupLoading(false);
        }
      });
  }

  const indexSpan = visibleRange.maximum - visibleRange.minimum;

  return (
    <section className="log-workspace" aria-label="Log workspace">
      <header className="workspace-heading">
        <div>
          <div className="workspace-title-row">
            <Typography.Title level={2}>{dataset.wellName}</Typography.Title>
            <Tag variant="filled">
              {document.sourceFormat} {document.sourceVersion}
            </Tag>
          </div>
          <Typography.Text className="workspace-subtitle">
            {formatIndex(fullIndexMinimum, dataset)} — {formatIndex(fullIndexMaximum, dataset)}{" "}
            {dataset.indexUnit} {dataset.indexMnemonic}
          </Typography.Text>
        </div>

        <div className="view-toolbar" aria-label="View controls">
          <Tooltip title="Center on cursor">
            <Button aria-label="Center on cursor" icon={<AimOutlined />} onClick={() => setIndexSpan(indexSpan)} shape="circle" type="text" />
          </Tooltip>
          <Tooltip title="Zoom in">
            <Button aria-label="Zoom in" icon={<ZoomInOutlined />} onClick={() => setIndexSpan(indexSpan * 0.6)} shape="circle" type="text" />
          </Tooltip>
          <Tooltip title="Zoom out">
            <Button aria-label="Zoom out" icon={<ZoomOutOutlined />} onClick={() => setIndexSpan(indexSpan / 0.6)} shape="circle" type="text" />
          </Tooltip>
          <Tooltip title="Fit full range">
            <Button
              aria-label="Fit full range"
              icon={<CompressOutlined />}
              onClick={() => setVisibleRange({ minimum: fullIndexMinimum, maximum: fullIndexMaximum })}
              shape="circle"
              type="text"
            />
          </Tooltip>
        </div>
      </header>

      <div className="workspace-warning">
        {document.warnings.length > 0 ? (
          <Alert banner message={document.warnings[0]} showIcon type="warning" />
        ) : null}
      </div>

      <div className="curve-toolbar">
        <div className="curve-selection" aria-label="Curve visibility controls">
          <div className="curve-selection-heading">
            <span>Curves on graph</span>
            <span className="curve-selection-count">
              {displayedCurves.length} of {displayableCurves.length}
            </span>
            <Button
              disabled={displayedCurves.length === displayableCurves.length}
              onClick={() => onVisibleCurveIdsChange(displayableCurves.map((curve) => curve.id))}
              size="small"
              type="text"
            >
              Select all
            </Button>
            <Button
              disabled={displayedCurves.length === 0}
              onClick={() => onVisibleCurveIdsChange([])}
              size="small"
              type="text"
            >
              Clear
            </Button>
          </div>

          <div className="curve-chip-list" aria-label="Visible curves">
            {displayedCurves.map((curve) => (
              <button
                aria-pressed={selectedCurveId === curve.id}
                className={`curve-chip is-visible${selectedCurveId === curve.id ? " is-active" : ""}`}
                key={curve.id}
                onClick={() => onCurveSelect(curve.id)}
                type="button"
              >
                <span aria-hidden="true" className="curve-chip-line" style={{ backgroundColor: curve.color }} />
                {curve.mnemonic}
              </button>
            ))}
          </div>
        </div>

        <div className="cursor-readout">
          <span>{selectedCurve.mnemonic}</span>
          <strong>{formatCurveValue(cursorValue)}</strong>
          <span>{selectedCurve.unit}</span>
          {cursorLookupLoading ? <Spin size="small" /> : null}
          {exactCursorValue ? <small>{exactCursorValue.status}</small> : <small>viewport</small>}
        </div>
      </div>

      <div className="instrument-shell" ref={instrumentRef}>
        <div className="instrument-core">
          {displayedCurves.length > 0 ? (
            <>
              <WellLogChart
                curves={displayedCurves}
                cursorIndex={cursorIndex}
                dataset={dataset}
                fullRange={{ minimum: fullIndexMinimum, maximum: fullIndexMaximum }}
                indexMnemonic={dataset.indexMnemonic}
                indexUnit={dataset.indexUnit}
                onCursorChange={lockCursor}
                onCurveSelect={onCurveSelect}
                onViewportChange={setVisibleRange}
                samplesByCurve={viewport.samplesByCurve}
                selectedCurveId={selectedCurveId}
                visibleRange={visibleRange}
              />
              {viewport.loading ? <div className="chart-loading"><Spin size="small" /> Loading visible range</div> : null}
              {viewport.error ? <div className="chart-error" role="alert">{viewport.error}</div> : null}
            </>
          ) : (
            <div className="empty-curve-selection" role="status">
              Select one or more curves in the document explorer.
            </div>
          )}
        </div>
      </div>

      <footer className="viewport-footer">
        <span>Visible range <strong>{formatIndex(visibleRange.minimum, dataset)} — {formatIndex(visibleRange.maximum, dataset)}</strong></span>
        <span>Cursor <strong>{formatIndex(cursorIndex, dataset)} {dataset.indexMnemonic}</strong></span>
        <span>LOD · bounded Arrow</span>
      </footer>
    </section>
  );
}

function findNearestLoadedValue(
  samples: readonly { readonly index: number; readonly value: number | null }[],
  index: number,
): number | null {
  let nearestValue: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    if (sample.value === null) {
      continue;
    }
    const distance = Math.abs(sample.index - index);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestValue = sample.value;
    }
  }
  return nearestValue;
}

function formatIndex(value: number, dataset: WorkspaceDataset): string {
  if (dataset.indexKind !== "time") {
    return value.toLocaleString(displayLocale, { maximumFractionDigits: 2 });
  }
  if (dataset.viewSettings.timeDisplayMode === "elapsed") {
    const seconds = Math.round(value - (dataset.indexMinimum ?? 0));
    const hours = Math.floor(Math.abs(seconds) / 3_600);
    const minutes = Math.floor((Math.abs(seconds) % 3_600) / 60);
    const remainder = Math.abs(seconds) % 60;
    return `${seconds < 0 ? "−" : ""}${[hours, minutes, remainder].map((part) => part.toString().padStart(2, "0")).join(":")}`;
  }
  const settings = dataset.viewSettings;
  const timestamp =
    settings.manualAnchorIndex !== null && settings.manualAnchorTimestamp !== null
      ? settings.manualAnchorTimestamp + (value - settings.manualAnchorIndex)
      : dataset.timeIndexReference === "absolute_utc"
        ? value
        : null;
  if (timestamp === null) {
    return value.toLocaleString(displayLocale, { maximumFractionDigits: 2 });
  }
  return new Intl.DateTimeFormat(displayLocale, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: settings.timeZone === "utc" ? "UTC" : undefined,
  }).format(new Date(timestamp * 1000));
}
