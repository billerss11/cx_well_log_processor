import {
  Descriptions,
  Progress,
  Tag,
  Typography,
  type DescriptionsProps,
} from "antd";

import type { CurveDefinition } from "./demoData";

interface CurveInspectorProps {
  readonly curve: CurveDefinition;
}

export function CurveInspector({ curve }: CurveInspectorProps) {
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
      children: `${curve.minimum} — ${curve.maximum}`,
    },
    {
      key: "samples",
      label: "Samples",
      children: curve.sampleCount,
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
          <span>Main pass · Main bore</span>
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
          <strong>99.7%</strong>
          <Progress
            percent={99.7}
            showInfo={false}
            size="small"
            strokeColor="#3f7d5a"
          />
        </div>
        <div className="quality-row">
          <span>Null values</span>
          <strong>0.3%</strong>
          <Progress
            percent={0.3}
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
            <dd>orion_a12_main.las</dd>
          </div>
          <div>
            <dt>Imported</dt>
            <dd>18 Jun 2024 · 14:32</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>Source · r1</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
