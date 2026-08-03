import AimOutlined from "@ant-design/icons/AimOutlined";
import CompressOutlined from "@ant-design/icons/CompressOutlined";
import ZoomInOutlined from "@ant-design/icons/ZoomInOutlined";
import ZoomOutOutlined from "@ant-design/icons/ZoomOutOutlined";
import { Button, Tag, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";

import { WellLogPreview } from "./WellLogPreview";
import {
  findCurve,
  findNearestCurveValue,
  formatCurveValue,
  type WorkspaceDataset,
  type WorkspaceDocument,
} from "./workspaceTypes";

interface DepthRange {
  readonly minimum: number;
  readonly maximum: number;
}

interface LogWorkspaceProps {
  readonly dataset: WorkspaceDataset;
  readonly document: WorkspaceDocument;
  readonly selectedCurveId: string;
  readonly onCurveSelect: (curveId: string) => void;
}

export function LogWorkspace({
  dataset,
  document,
  selectedCurveId,
  onCurveSelect,
}: LogWorkspaceProps) {
  const fullDepthMinimum = dataset.indexMinimum ?? 0;
  const fullDepthMaximum = dataset.indexMaximum ?? Math.max(dataset.rowCount - 1, 1);
  const fullDepthSpan = fullDepthMaximum - fullDepthMinimum;
  const minimumDepthSpan = Math.max(fullDepthSpan / 100, 0.1);
  const [cursorDepth, setCursorDepth] = useState(
    () => fullDepthMinimum + fullDepthSpan / 2,
  );
  const [visibleRange, setVisibleRange] = useState<DepthRange>({
    minimum: fullDepthMinimum,
    maximum: fullDepthMaximum,
  });
  const displayableCurves = dataset.curves.filter(
    (curve) => curve.previewSamples.length > 0,
  );
  const selectedCurve = findCurve(displayableCurves, selectedCurveId);
  const displayedCurves = useMemo(() => {
    const initialCurves = displayableCurves.slice(0, 4);
    if (initialCurves.some((curve) => curve.id === selectedCurveId)) {
      return initialCurves;
    }
    if (initialCurves.length < 4) {
      return [...initialCurves, selectedCurve];
    }
    return [...initialCurves.slice(0, 3), selectedCurve];
  }, [displayableCurves, selectedCurve, selectedCurveId]);
  const cursorValue = findNearestCurveValue(selectedCurve, cursorDepth);

  function setDepthSpan(nextSpan: number): void {
    const boundedSpan = Math.min(
      fullDepthMaximum - fullDepthMinimum,
      Math.max(minimumDepthSpan, nextSpan),
    );
    let minimum = cursorDepth - boundedSpan / 2;
    let maximum = cursorDepth + boundedSpan / 2;

    if (minimum < fullDepthMinimum) {
      minimum = fullDepthMinimum;
      maximum = fullDepthMinimum + boundedSpan;
    }

    if (maximum > fullDepthMaximum) {
      maximum = fullDepthMaximum;
      minimum = fullDepthMaximum - boundedSpan;
    }

    setVisibleRange({ minimum, maximum });
  }

  const depthSpan = visibleRange.maximum - visibleRange.minimum;

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
            {fullDepthMinimum.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}{" "}
            —{" "}
            {fullDepthMaximum.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}{" "}
            {dataset.indexUnit} {dataset.indexMnemonic}
          </Typography.Text>
        </div>

        <div className="view-toolbar" aria-label="View controls">
          <Tooltip title="Center on cursor">
            <Button
              aria-label="Center on cursor"
              icon={<AimOutlined />}
              onClick={() => setDepthSpan(depthSpan)}
              shape="circle"
              type="text"
            />
          </Tooltip>
          <Tooltip title="Zoom in">
            <Button
              aria-label="Zoom in"
              icon={<ZoomInOutlined />}
              onClick={() => setDepthSpan(depthSpan * 0.6)}
              shape="circle"
              type="text"
            />
          </Tooltip>
          <Tooltip title="Zoom out">
            <Button
              aria-label="Zoom out"
              icon={<ZoomOutOutlined />}
              onClick={() => setDepthSpan(depthSpan / 0.6)}
              shape="circle"
              type="text"
            />
          </Tooltip>
          <Tooltip title="Fit full depth">
            <Button
              aria-label="Fit full depth"
              icon={<CompressOutlined />}
              onClick={() =>
                setVisibleRange({
                  minimum: fullDepthMinimum,
                  maximum: fullDepthMaximum,
                })
              }
              shape="circle"
              type="text"
            />
          </Tooltip>
        </div>
      </header>

      <div className="curve-toolbar">
        <div className="curve-chip-list" aria-label="Visible curves">
          {displayableCurves.map((curve) => (
            <button
              className={
                selectedCurveId === curve.id
                  ? "curve-chip is-selected"
                  : "curve-chip"
              }
              key={curve.id}
              onClick={() => onCurveSelect(curve.id)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="curve-chip-line"
                style={{ backgroundColor: curve.color }}
              />
              {curve.mnemonic}
            </button>
          ))}
        </div>

        <div className="cursor-readout">
          <span>{selectedCurve.mnemonic}</span>
          <strong>{formatCurveValue(cursorValue)}</strong>
          <span>{selectedCurve.unit}</span>
        </div>
      </div>

      <div className="instrument-shell">
        <div className="instrument-core">
          <WellLogPreview
            curves={displayedCurves}
            cursorDepth={cursorDepth}
            depthUnit={dataset.indexUnit}
            onCursorChange={setCursorDepth}
            onCurveSelect={onCurveSelect}
            selectedCurveId={selectedCurveId}
            visibleRange={visibleRange}
          />
        </div>
      </div>

      <footer className="viewport-footer">
        <span>
          Visible range{" "}
          <strong>
            {visibleRange.minimum.toFixed(1)} —{" "}
            {visibleRange.maximum.toFixed(1)} {dataset.indexUnit}
          </strong>
        </span>
        <span>
          Cursor{" "}
          <strong>
            {cursorDepth.toFixed(2)} {dataset.indexUnit} {dataset.indexMnemonic}
          </strong>
        </span>
        <span>LOD · screen optimized</span>
      </footer>
    </section>
  );
}
