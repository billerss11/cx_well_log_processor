import ExportOutlined from "@ant-design/icons/ExportOutlined";
import TableOutlined from "@ant-design/icons/TableOutlined";
import type {
  DatasetViewSettingsUpdate,
  MetadataObjectDetail,
  MetadataObjectSummary,
  QcIssue,
  QcReport,
} from "@welllog/ts-api-client";
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Select,
  Spin,
  Tabs,
  Tag,
  Typography,
  type DescriptionsProps,
} from "antd";
import { useEffect, useState } from "react";

import {
  getMetadataObjectDetail,
  getMetadataObjects,
} from "../../services/engineApi";
import { DataPreviewDrawer } from "./DataPreviewDrawer";
import { QualityControlPanel } from "./QualityControlPanel";
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
  readonly visibleCurveIds: readonly string[];
  readonly busy: boolean;
  readonly qcReport: QcReport | null;
  readonly qcLoading: boolean;
  readonly qcError: string | null;
  readonly onExport: (allScalarCurves: boolean) => Promise<void>;
  readonly onQcIssueSelect: (issue: QcIssue) => void;
  readonly onQcReload: () => void;
  readonly onViewSettingsSave: (settings: DatasetViewSettingsUpdate) => Promise<void>;
}

export function CurveInspector({
  curve,
  dataset,
  document,
  visibleCurveIds,
  busy,
  qcReport,
  qcLoading,
  qcError,
  onExport,
  onQcIssueSelect,
  onQcReload,
  onViewSettingsSave,
}: CurveInspectorProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const descriptionItems: DescriptionsProps["items"] = [
    { key: "unit", label: "Unit", children: curve.unit || "—" },
    { key: "scale", label: "Scale", children: curve.scale },
    {
      key: "range",
      label: "Value range",
      children: `${formatCurveValue(curve.minimum)} — ${formatCurveValue(curve.maximum)}`,
    },
    { key: "samples", label: "Samples", children: curve.sampleCount.toLocaleString() },
    { key: "nulls", label: "Nulls", children: curve.nullCount.toLocaleString() },
    { key: "storage", label: "Storage", children: curve.storageKind },
  ];

  return (
    <aside className="inspector-pane" aria-label="Document inspector">
      <div className="pane-heading">
        <div>
          <Typography.Text className="pane-eyebrow">Inspector</Typography.Text>
          <Typography.Title level={2}>{curve.mnemonic}</Typography.Title>
        </div>
      </div>

      <Tabs
        className="inspector-tabs"
        items={[
          {
            key: "curve",
            label: "Curve",
            children: (
              <div className="inspector-tab-scroll">
                <div className="curve-identity-card">
                  <span aria-hidden="true" className="curve-identity-line" style={{ backgroundColor: curve.color }} />
                  <div><strong>{curve.description}</strong><span>{dataset.name}</span></div>
                  <Tag variant="filled">Source</Tag>
                </div>
                <section className="inspector-section">
                  <Typography.Text className="section-label">Definition</Typography.Text>
                  <Descriptions className="curve-descriptions" colon={false} column={1} items={descriptionItems} size="small" />
                </section>
                <section className="inspector-section provenance-section">
                  <Typography.Text className="section-label">Provenance</Typography.Text>
                  <dl>
                    <div><dt>Source</dt><dd>{document.sourceFile}</dd></div>
                    <div><dt>Format</dt><dd>{document.sourceFormat} {document.sourceVersion}</dd></div>
                    <div><dt>Status</dt><dd>{document.modified ? "Modified" : document.saved ? "Saved CX Log" : "Unsaved session"}</dd></div>
                  </dl>
                </section>
              </div>
            ),
          },
          {
            key: "dataset",
            label: "Dataset",
            children: (
              <DatasetInspector
                busy={busy}
                dataset={dataset}
                onExport={onExport}
                onPreview={() => setPreviewOpen(true)}
                onViewSettingsSave={onViewSettingsSave}
                selectedCount={visibleCurveIds.length}
              />
            ),
          },
          {
            key: "qc",
            label: (
              <span className="qc-tab-label">
                QC
                {qcReport?.summary.issue_count ? (
                  <span>{qcReport.summary.issue_count}</span>
                ) : null}
              </span>
            ),
            children: (
              <QualityControlPanel
                error={qcError}
                loading={qcLoading}
                onIssueSelect={onQcIssueSelect}
                onReload={onQcReload}
                report={qcReport}
                selectedCurveId={curve.id}
              />
            ),
          },
          {
            key: "metadata",
            label: "Metadata",
            children: <MetadataBrowser documentId={document.id} />,
          },
        ]}
      />

      <DataPreviewDrawer
        curveIds={visibleCurveIds}
        dataset={dataset}
        documentId={document.id}
        onClose={() => setPreviewOpen(false)}
        open={previewOpen}
      />
    </aside>
  );
}

interface DatasetInspectorProps {
  readonly dataset: WorkspaceDataset;
  readonly selectedCount: number;
  readonly busy: boolean;
  readonly onPreview: () => void;
  readonly onExport: (allScalarCurves: boolean) => Promise<void>;
  readonly onViewSettingsSave: (settings: DatasetViewSettingsUpdate) => Promise<void>;
}

function DatasetInspector({
  dataset,
  selectedCount,
  busy,
  onPreview,
  onExport,
  onViewSettingsSave,
}: DatasetInspectorProps) {
  const [mode, setMode] = useState(dataset.viewSettings.timeDisplayMode);
  const [timeZone, setTimeZone] = useState(dataset.viewSettings.timeZone);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(dataset.viewSettings.manualAnchorIndex);
  const [anchorTime, setAnchorTime] = useState(
    toDateTimeLocal(dataset.viewSettings.manualAnchorTimestamp),
  );

  useEffect(() => {
    setMode(dataset.viewSettings.timeDisplayMode);
    setTimeZone(dataset.viewSettings.timeZone);
    setAnchorIndex(dataset.viewSettings.manualAnchorIndex);
    setAnchorTime(toDateTimeLocal(dataset.viewSettings.manualAnchorTimestamp));
  }, [dataset.id, dataset.viewSettings]);

  return (
    <div className="inspector-tab-scroll dataset-inspector">
      <Descriptions
        colon={false}
        column={1}
        items={[
          { key: "rows", label: "Rows", children: dataset.rowCount.toLocaleString() },
          { key: "curves", label: "Scalar curves", children: dataset.scalarCurveCount.toLocaleString() },
          { key: "index", label: "Canonical index", children: `${dataset.indexMnemonic} ${dataset.indexUnit}`.trim() },
          { key: "index-type", label: "Index type", children: dataset.indexKind },
          { key: "reference", label: "Time reference", children: dataset.timeIndexReference },
        ]}
        size="small"
      />

      <div className="dataset-actions">
        <Button icon={<TableOutlined />} onClick={onPreview}>Preview rows</Button>
        <Button disabled={selectedCount === 0} icon={<ExportOutlined />} loading={busy} onClick={() => void onExport(false)}>
          Export visible
        </Button>
        <Button icon={<ExportOutlined />} loading={busy} onClick={() => void onExport(true)}>
          Export all
        </Button>
      </div>

      {dataset.indexKind === "time" ? (
        <section className="time-settings">
          <Typography.Text className="section-label">Time display</Typography.Text>
          <label>
            Display
            <Select
              onChange={setMode}
              options={[{ label: "Elapsed", value: "elapsed" }, { label: "Clock time", value: "clock" }]}
              value={mode}
            />
          </label>
          <label>
            Clock zone
            <Select
              onChange={setTimeZone}
              options={[{ label: "UTC", value: "utc" }, { label: "Local", value: "local" }]}
              value={timeZone}
            />
          </label>
          <label>
            Anchor index (seconds)
            <InputNumber onChange={(value) => setAnchorIndex(value)} value={anchorIndex} />
          </label>
          <label>
            Anchor clock time
            <input onChange={(event) => setAnchorTime(event.target.value)} type="datetime-local" value={anchorTime} />
          </label>
          <Button
            loading={busy}
            onClick={() =>
              void onViewSettingsSave({
                manual_anchor_index: anchorIndex,
                manual_anchor_timestamp: anchorTime ? Date.parse(anchorTime) / 1000 : null,
                time_display_mode: mode,
                time_zone: timeZone,
              })
            }
            type="primary"
          >
            Apply view settings
          </Button>
          <small>Changes mark this document modified and are stored only by Save As.</small>
        </section>
      ) : null}
    </div>
  );
}

function MetadataBrowser({ documentId }: { readonly documentId: string }) {
  const [objects, setObjects] = useState<readonly MetadataObjectSummary[]>([]);
  const [selected, setSelected] = useState<MetadataObjectDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void getMetadataObjects(documentId, 0, search || undefined)
        .then((page) => setObjects(page.items))
        .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : "Could not load metadata."))
        .finally(() => setLoading(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [documentId, search]);

  function openObject(objectId: string): void {
    setLoading(true);
    void getMetadataObjectDetail(documentId, objectId)
      .then(setSelected)
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : "Could not load metadata details."))
      .finally(() => setLoading(false));
  }

  return (
    <div className="inspector-tab-scroll metadata-browser">
      <Input.Search allowClear onChange={(event) => setSearch(event.target.value)} placeholder="Search metadata" value={search} />
      {error ? <Alert message={error} showIcon type="error" /> : null}
      {loading ? <Spin size="small" /> : null}
      {objects.length === 0 && !loading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No metadata objects" /> : null}
      <div className="metadata-object-list">
        {objects.map((item) => (
          <button
            aria-pressed={selected?.id === item.id}
            className={`metadata-object-button${selected?.id === item.id ? " is-selected" : ""}`}
            key={item.id}
            onClick={() => openObject(item.id)}
            type="button"
          >
            <strong>{item.name || item.native_id}</strong>
            <span>{metadataObjectTypeLabel(item.object_type)}</span>
          </button>
        ))}
      </div>
      {selected ? <MetadataDetail detail={selected} /> : null}
    </div>
  );
}

function MetadataDetail({ detail }: { readonly detail: MetadataObjectDetail }) {
  if (detail.object_type === "LAS_HEADER" && isMetadataRecord(detail.content_json)) {
    return (
      <div className="metadata-detail">
        {detail.truncated ? <Alert message="Metadata detail was truncated." type="warning" /> : null}
        <LasHeaderMetadata content={detail.content_json} />
      </div>
    );
  }

  if (detail.content_json !== null && detail.content_json !== undefined) {
    return (
      <div className="metadata-detail">
        {detail.truncated ? <Alert message="Metadata detail was truncated." type="warning" /> : null}
        <StructuredMetadata value={detail.content_json} />
      </div>
    );
  }

  return (
    <div className="metadata-detail">
      {detail.truncated ? <Alert message="Metadata detail was truncated." type="warning" /> : null}
      <MetadataText value={detail.text} />
    </div>
  );
}

const lasMetadataSections = [
  ["version", "Version"],
  ["well", "Well"],
  ["curves", "Curves"],
  ["parameters", "Parameters"],
  ["other", "Other"],
] as const;
const maximumRenderedMetadataItems = 100;

function LasHeaderMetadata({
  content,
}: {
  readonly content: Record<string, unknown>;
}) {
  return (
    <Collapse
      defaultActiveKey={["version", "well"]}
      items={lasMetadataSections.map(([key, label]) => ({
        children: <LasMetadataSection value={content[key]} />,
        key,
        label: (
          <span className="metadata-section-label">
            <span>{label}</span>
            <small>{metadataItemCount(content[key])}</small>
          </span>
        ),
      }))}
      size="small"
    />
  );
}

function LasMetadataSection({ value }: { readonly value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <MetadataEmpty />;
    }
    const visibleItems = value.slice(0, maximumRenderedMetadataItems);
    return (
      <div className="metadata-las-list">
        {visibleItems.map((item, index) =>
          isMetadataRecord(item) ? (
            <LasMetadataEntry item={item} key={`${String(item.mnemonic ?? "entry")}-${index}`} />
          ) : (
            <StructuredMetadata key={index} value={item} />
          ),
        )}
        <MetadataLimitNotice shown={visibleItems.length} total={value.length} />
      </div>
    );
  }
  if (typeof value === "string") {
    return <MetadataText value={value} />;
  }
  return <StructuredMetadata value={value} />;
}

function LasMetadataEntry({ item }: { readonly item: Record<string, unknown> }) {
  const mnemonic = metadataString(item.mnemonic) || "Entry";
  const unit = metadataString(item.unit);
  const description = metadataString(item.description);
  return (
    <div className="metadata-las-entry">
      <div className="metadata-las-identity">
        <strong>{mnemonic}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      <div className="metadata-las-content">
        <span className="metadata-las-value">{formatMetadataPrimitive(item.value)}</span>
        {description ? <small>{description}</small> : null}
      </div>
    </div>
  );
}

function StructuredMetadata({ value }: { readonly value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <MetadataEmpty />;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <MetadataEmpty />;
    }
    const visibleItems = value.slice(0, maximumRenderedMetadataItems);
    return (
      <div className="metadata-array-list">
        {visibleItems.map((item, index) => (
          <div className="metadata-array-item" key={index}>
            <small>Item {index + 1}</small>
            <StructuredMetadata value={item} />
          </div>
        ))}
        <MetadataLimitNotice shown={visibleItems.length} total={value.length} />
      </div>
    );
  }
  if (isMetadataRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <MetadataEmpty />;
    }
    const visibleEntries = entries.slice(0, maximumRenderedMetadataItems);
    return (
      <div className="metadata-property-group">
        <dl className="metadata-property-list">
          {visibleEntries.map(([key, item]) => (
            <div key={key}>
              <dt>{metadataLabel(key)}</dt>
              <dd><StructuredMetadata value={item} /></dd>
            </div>
          ))}
        </dl>
        <MetadataLimitNotice shown={visibleEntries.length} total={entries.length} />
      </div>
    );
  }
  return <span className="metadata-primitive">{formatMetadataPrimitive(value)}</span>;
}

function MetadataText({ value }: { readonly value: string | null | undefined }) {
  const text = value?.replace(/\r\n/g, "\n").trim() ?? "";
  if (!text || text === "#") {
    return <MetadataEmpty />;
  }
  return <p className="metadata-text">{text}</p>;
}

function MetadataEmpty() {
  return <span className="metadata-empty">No entries</span>;
}

function MetadataLimitNotice({
  shown,
  total,
}: {
  readonly shown: number;
  readonly total: number;
}) {
  if (shown >= total) {
    return null;
  }
  return <small className="metadata-limit">Showing the first {shown.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")} entries.</small>;
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function formatMetadataPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "number") {
    return value.toLocaleString("en-GB", { maximumFractionDigits: 6 });
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value).trim() || "—";
}

function metadataItemCount(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length.toLocaleString("en-GB");
  }
  if (isMetadataRecord(value)) {
    return Object.keys(value).length.toLocaleString("en-GB");
  }
  return typeof value === "string" && value.trim() && value.trim() !== "#" ? "1" : "0";
}

function metadataLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function metadataObjectTypeLabel(value: string): string {
  return metadataLabel(value.toLowerCase())
    .replace(/^Las\b/, "LAS")
    .replace(/^Dlis\b/, "DLIS")
    .replace(/^Witsml\b/, "WITSML");
}

function toDateTimeLocal(timestamp: number | null): string {
  if (timestamp === null) {
    return "";
  }
  const date = new Date(timestamp * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
