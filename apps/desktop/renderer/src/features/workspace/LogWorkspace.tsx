import AimOutlined from "@ant-design/icons/AimOutlined";
import CompressOutlined from "@ant-design/icons/CompressOutlined";
import ZoomInOutlined from "@ant-design/icons/ZoomInOutlined";
import ZoomOutOutlined from "@ant-design/icons/ZoomOutOutlined";
import { Button, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";

import { curves, findCurve } from "./demoData";
import { WellLogPreview } from "./WellLogPreview";

const fullDepthMinimum = 2300;
const fullDepthMaximum = 2420;
const minimumDepthSpan = 15;

interface DepthRange {
  readonly minimum: number;
  readonly maximum: number;
}

interface LogWorkspaceProps {
  readonly selectedCurveId: string;
  readonly onCurveSelect: (curveId: string) => void;
}

export function LogWorkspace({
  selectedCurveId,
  onCurveSelect,
}: LogWorkspaceProps) {
  const [cursorDepth, setCursorDepth] = useState(2338.6);
  const [visibleRange, setVisibleRange] = useState<DepthRange>({
    minimum: fullDepthMinimum,
    maximum: fullDepthMaximum,
  });
  const selectedCurve = findCurve(selectedCurveId);

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
            <Typography.Title level={2}>Orion A-12</Typography.Title>
            <Tag variant="filled">Main pass</Tag>
          </div>
          <Typography.Text className="workspace-subtitle">
            2,300.0 — 2,420.0 m MD
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
          {curves.map((curve) => (
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
          <strong>{selectedCurve.currentValue}</strong>
          <span>{selectedCurve.unit}</span>
        </div>
      </div>

      <div className="instrument-shell">
        <div className="instrument-core">
          <WellLogPreview
            cursorDepth={cursorDepth}
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
            {visibleRange.maximum.toFixed(1)} m
          </strong>
        </span>
        <span>
          Cursor <strong>{cursorDepth.toFixed(1)} m MD</strong>
        </span>
        <span>LOD · screen optimized</span>
      </footer>
    </section>
  );
}
