import { ArrowDataClient, type PreviewPage } from "@welllog/arrow-data-client";
import { Alert, Button, Drawer, Spin } from "antd";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceDataset } from "./workspaceTypes";

const arrowClient = new ArrowDataClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765",
});

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
  const [height, setHeight] = useState(360);
  const [dragging, setDragging] = useState(false);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<PreviewPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragStart = useRef({ height: 360, y: 0 });

  useEffect(() => {
    if (!dragging) {
      return;
    }
    function resize(event: MouseEvent): void {
      setHeight(
        Math.min(
          window.innerHeight - 120,
          Math.max(220, dragStart.current.height + dragStart.current.y - event.clientY),
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
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void arrowClient
      .previewPage(
        documentId,
        dataset.id,
        { curveIds: curveIds.slice(0, 32), page, pageSize: 100 },
        controller.signal,
      )
      .then(setPreview)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError(requestError instanceof Error ? requestError.message : "Could not load preview.");
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [curveIds, dataset.id, documentId, open, page]);

  const curveById = new Map(dataset.curves.map((curve) => [curve.id, curve]));

  return (
    <Drawer
      destroyOnHidden
      height={height}
      onClose={onClose}
      open={open}
      placement="bottom"
      title={`Data preview · ${dataset.name}`}
    >
      <div
        aria-label="Resize data preview"
        className="drawer-resize-handle"
        onMouseDown={(event) => {
          dragStart.current = { height, y: event.clientY };
          setDragging(true);
        }}
        role="separator"
      />
      {error ? <Alert message={error} showIcon type="error" /> : null}
      <div className="preview-table-scroll">
        {loading && !preview ? <Spin /> : null}
        {preview ? (
          <table className="preview-table">
            <thead>
              <tr>
                {preview.columns.map((column) => (
                  <th key={column}>
                    {column === "__index"
                      ? dataset.indexMnemonic
                      : curveById.get(column)?.mnemonic ?? column}
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
      </div>
      <div className="preview-pagination">
        <Button disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>
          Previous 100
        </Button>
        <span>Rows {page * 100 + 1}–{page * 100 + (preview?.rows.length ?? 0)}</span>
        <Button disabled={loading || (preview?.rows.length ?? 0) < 100} onClick={() => setPage((value) => value + 1)}>
          Next 100
        </Button>
      </div>
    </Drawer>
  );
}

function formatCell(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "number"
    ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : value;
}
