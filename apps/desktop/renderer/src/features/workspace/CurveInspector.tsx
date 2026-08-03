import {
  Descriptions,
  Progress,
  Tag,
  Typography,
  type DescriptionsProps,
} from "antd";

import {
  formatCurveValue,
  type CurveDefinition,
  type WorkspaceDataset,
  type WorkspaceDocument,
} from "./workspaceTypes";

interface CurveInspectorProps {
  readonly curve: CurveDefinition;
  readonly dataset: WorkspaceDataset;
  readonly document: WorkspaceDocument;
}

export function CurveInspector({ curve, dataset, document }: CurveInspectorProps) {
  const validSampleCount = curve.sampleCount - curve.nullCount;
  const validPercent =
    curve.sampleCount > 0 ? (validSampleCount / curve.sampleCount) * 100 : 0;
  const nullPercent = 100 - validPercent;
  const descriptionItems: DescriptionsProps["items"] = [
    {
      key: "unit",
      label: "Unit",
      children: curve.unit,
    },
    {
      key: "scale",
      label: "Scale",
      children: curve.scale,
    },
    {
      key: "range",
      label: "Display range",
      children: `${formatCurveValue(curve.minimum)} — ${formatCurveValue(curve.maximum)}`,
    },
    {
      key: "samples",
      label: "Samples",
      children: curve.sampleCount.toLocaleString(),
    },
    {
      key: "storage",
      label: "Internal storage",
      children: curve.storageKind,
    },
  ];

  return (
    <aside className="inspector-pane" aria-label="Curve inspector">
      <div className="pane-heading">
        <div>
          <Typography.Text className="pane-eyebrow">
            Curve details
          </Typography.Text>
          <Typography.Title level={2}>{curve.mnemonic}</Typography.Title>
        </div>
      </div>

      <div className="curve-identity-card">
        <span
          aria-hidden="true"
          className="curve-identity-line"
          style={{ backgroundColor: curve.color }}
        />
        <div>
          <strong>{curve.description}</strong>
          <span>{dataset.name}</span>
        </div>
        <Tag color="success" variant="filled">
          Source
        </Tag>
      </div>

      <section className="inspector-section">
        <Typography.Text className="section-label">
          Definition
        </Typography.Text>
        <Descriptions
          className="curve-descriptions"
          colon={false}
          column={1}
          items={descriptionItems}
          size="small"
        />
      </section>

      <section className="inspector-section">
        <div className="quality-heading">
          <Typography.Text className="section-label">
            Data quality
          </Typography.Text>
          <Tag color="success" variant="filled">
            Passed
          </Tag>
        </div>

        <div className="quality-row">
          <span>Valid samples</span>
          <strong>{validPercent.toFixed(1)}%</strong>
          <Progress
            percent={validPercent}
            showInfo={false}
            size="small"
            strokeColor="#3f7d5a"
          />
        </div>
        <div className="quality-row">
          <span>Null values</span>
          <strong>{nullPercent.toFixed(1)}%</strong>
          <Progress
            percent={nullPercent}
            showInfo={false}
            size="small"
            strokeColor="#b46f32"
          />
        </div>
      </section>

      <section className="inspector-section provenance-section">
        <Typography.Text className="section-label">
          Provenance
        </Typography.Text>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>{document.sourceFile}</dd>
          </div>
          <div>
            <dt>Source format</dt>
            <dd>{document.sourceFormat} {document.sourceVersion}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{document.saved ? "Saved CX Log" : "Unsaved session"}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
