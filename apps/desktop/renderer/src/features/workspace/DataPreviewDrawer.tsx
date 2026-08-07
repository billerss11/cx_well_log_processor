import { ArrowDataClient, type PreviewPage } from "@welllog/arrow-data-client";
import { Alert, Button, Drawer, InputNumber, Select, Spin } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  isDisplayableCurve,
  type CurveDefinition,
  type WorkspaceDataset,
} from "./workspaceTypes";

const PAGE_SIZE = 100;
const MAX_PREVIEW_CURVES = 32;

const arrowClient = new ArrowDataClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765",
});

interface IndexFilter {
  readonly minimum: number | null;
  readonly maximum: number | null;
}

interface DataPreviewDrawerProps {
  readonly documentId: string;
  readonly dataset: WorkspaceDataset;
  readonly curveIds: readonly string[];
  readonly open: boolean;
  readonly onClose: () => void;
}

export function DataPreviewDrawer({
  documentId,
  dataset,
  curveIds,
  open,
  onClose,
}: DataPreviewDrawerProps) {
  const [height, setHeight] = useState(440);
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedCurveIds, setSelectedCurveIds] = useState<readonly string[]>([]);
  const [draftMinimum, setDraftMinimum] = useState<number | null>(null);
  const [draftMaximum, setDraftMaximum] = useState<number | null>(null);
  const [indexFilter, setIndexFilter] = useState<IndexFilter>({
    minimum: null,
    maximum: null,
  });
  const [preview, setPreview] = useState<PreviewPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragStart = useRef({ height: 440, y: 0 });
  const requestId = useRef(0);
  const displayableCurves = useMemo(
    () => dataset.curves.filter(isDisplayableCurve),
    [dataset.curves],
  );
  const curveById = useMemo(
    () => new Map(dataset.curves.map((curve) => [curve.id, curve])),
    [dataset.curves],
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }
    function resize(event: MouseEvent): void {
      setHeight(
        Math.min(
          window.innerHeight - 120,
          Math.max(280, dragStart.current.height + dragStart.current.y - event.clientY),
        ),
      );
    }
    function stopResizing(): void {
      setDragging(false);
    }
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing, { once: true });
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [dragging]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const availableIds = new Set(displayableCurves.map((curve) => curve.id));
    const plottedCurveIds = curveIds
      .filter((curveId) => availableIds.has(curveId))
      .slice(0, MAX_PREVIEW_CURVES);
    setSelectedCurveIds(
      plottedCurveIds.length > 0
        ? plottedCurveIds
        : displayableCurves.slice(0, 8).map((curve) => curve.id),
    );
    setDraftMinimum(null);
    setDraftMaximum(null);
    setIndexFilter({ minimum: null, maximum: null });
    setPage(0);
    setPreview(null);
    setError(null);
  }, [curveIds, displayableCurves, open]);

  useEffect(() => {
    if (!open || selectedCurveIds.length === 0) {
      setLoading(false);
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(true);
    setError(null);
    void arrowClient
      .previewPage(
        documentId,
        dataset.id,
        {
          curveIds: selectedCurveIds,
          indexMaximum: indexFilter.maximum ?? undefined,
          indexMinimum: indexFilter.minimum ?? undefined,
          page,
          pageSize: PAGE_SIZE,
        },
        controller.signal,
      )
      .then((nextPreview) => {
        if (requestId.current === currentRequestId) {
          setPreview(nextPreview);
        }
      })
      .catch((requestError: unknown) => {
        if (
          requestId.current === currentRequestId &&
          !(requestError instanceof DOMException && requestError.name === "AbortError")
        ) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not load table rows.",
          );
        }
      })
      .finally(() => {
        if (requestId.current === currentRequestId) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [
    dataset.id,
    documentId,
    indexFilter.maximum,
    indexFilter.minimum,
    open,
    page,
    selectedCurveIds,
  ]);

  function selectCurves(nextCurveIds: readonly string[]): void {
    setSelectedCurveIds(nextCurveIds.slice(0, MAX_PREVIEW_CURVES));
    setPage(0);
  }

  function applyIndexFilter(): void {
    let minimum = draftMinimum;
    let maximum = draftMaximum;
    if (minimum !== null && maximum !== null && minimum > maximum) {
      [minimum, maximum] = [maximum, minimum];
      setDraftMinimum(minimum);
      setDraftMaximum(maximum);
    }
    setIndexFilter({ minimum, maximum });
    setPage(0);
  }

  function clearIndexFilter(): void {
    setDraftMinimum(null);
    setDraftMaximum(null);
    setIndexFilter({ minimum: null, maximum: null });
    setPage(0);
  }

  const filtered = indexFilter.minimum !== null || indexFilter.maximum !== null;
  const columnOptions = displayableCurves.map((curve) => ({
    label: curveLabel(curve),
    value: curve.id,
  }));

  return (
    <Drawer
      destroyOnHidden
      onClose={onClose}
      open={open}
      placement="bottom"
      size={height}
      title={`Data table · ${dataset.name} · ${dataset.rowCount.toLocaleString()} rows`}
    >
      <div
        aria-label="Resize data table"
        className="drawer-resize-handle"
        onMouseDown={(event) => {
          dragStart.current = { height, y: event.clientY };
          setDragging(true);
        }}
        role="separator"
      />

      <div className="data-preview-content">
        <div className="preview-controls">
          <div className="preview-column-control">
            <span className="preview-control-label">Curve columns</span>
            <Select
              allowClear
              aria-label="Curve columns"
              className="preview-column-select"
              maxCount={MAX_PREVIEW_CURVES}
              maxTagCount="responsive"
              mode="multiple"
              onChange={selectCurves}
              optionFilterProp="label"
              options={columnOptions}
              placeholder="Choose curves"
              showSearch
              value={[...selectedCurveIds]}
            />
            <div className="preview-column-actions">
              <Button onClick={() => selectCurves(curveIds)} size="small">
                Plotted curves
              </Button>
              <Button
                onClick={() =>
                  selectCurves(
                    displayableCurves
                      .slice(0, MAX_PREVIEW_CURVES)
                      .map((curve) => curve.id),
                  )
                }
                size="small"
              >
                {displayableCurves.length <= MAX_PREVIEW_CURVES
                  ? "All curves"
                  : "First 32 curves"}
              </Button>
            </div>
          </div>

          <div className="preview-range-control" role="group" aria-label={`${dataset.indexMnemonic} range filter`}>
            <span className="preview-control-label">{dataset.indexMnemonic} range</span>
            <div className="preview-range-fields">
              <InputNumber
                aria-label={`Minimum ${dataset.indexMnemonic}`}
                onChange={(value) => setDraftMinimum(value)}
                placeholder={formatCell(dataset.indexMinimum)}
                value={draftMinimum}
              />
              <span>to</span>
              <InputNumber
                aria-label={`Maximum ${dataset.indexMnemonic}`}
                onChange={(value) => setDraftMaximum(value)}
                placeholder={formatCell(dataset.indexMaximum)}
                value={draftMaximum}
              />
              <span>{dataset.indexUnit}</span>
              <Button onClick={applyIndexFilter} size="small" type="primary">
                Apply
              </Button>
              <Button disabled={!filtered && draftMinimum === null && draftMaximum === null} onClick={clearIndexFilter} size="small">
                Clear
              </Button>
            </div>
          </div>
        </div>

        {error ? <Alert message={error} showIcon type="error" /> : null}

        <div className="preview-table-scroll">
          {loading && !preview ? <Spin /> : null}
          {selectedCurveIds.length === 0 ? (
            <div className="preview-empty-selection" role="status">
              Choose at least one curve column to view data.
            </div>
          ) : null}
          {preview ? (
            <table className="preview-table">
              <thead>
                <tr>
                  {preview.columns.map((column) => (
                    <th key={column} scope="col">
                      {column === "__index" ? (
                        <span className="preview-column-heading">
                          <strong>{dataset.indexMnemonic}</strong>
                          <small>{dataset.indexUnit || "Index"}</small>
                        </span>
                      ) : (
                        <CurveColumnHeading curve={curveById.get(column)} fallback={column} />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  <tr key={`${page}:${rowIndex}`}>
                    {preview.columns.map((column) => (
                      <td key={column}>{formatCell(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {preview && preview.rows.length === 0 ? (
            <div className="preview-empty-selection" role="status">
              No rows match this {dataset.indexMnemonic} range.
            </div>
          ) : null}
        </div>

        <div className="preview-pagination">
          <span className="preview-pagination-summary">
            {filtered ? "Filtered · " : ""}
            {selectedCurveIds.length.toLocaleString()} curves
          </span>
          <Button
            disabled={page === 0 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous {PAGE_SIZE}
          </Button>
          <span>
            Rows {page * PAGE_SIZE + 1}–
            {page * PAGE_SIZE + (preview?.rows.length ?? 0)}
          </span>
          <Button
            disabled={loading || (preview?.rows.length ?? 0) < PAGE_SIZE}
            onClick={() => setPage((value) => value + 1)}
          >
            Next {PAGE_SIZE}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function CurveColumnHeading({
  curve,
  fallback,
}: {
  readonly curve: CurveDefinition | undefined;
  readonly fallback: string;
}) {
  if (!curve) {
    return <span className="preview-column-heading"><strong>{fallback}</strong></span>;
  }
  return (
    <span className="preview-column-heading" title={curveLabel(curve)}>
      <strong>{curve.mnemonic}</strong>
      <span>{curve.description}</span>
      <small>{curve.unit || "No unit"}</small>
    </span>
  );
}

function curveLabel(curve: CurveDefinition): string {
  return `${curve.mnemonic} · ${curve.description}${curve.unit ? ` · ${curve.unit}` : ""}`;
}

function formatCell(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "number"
    ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : value;
}
