import ReloadOutlined from "@ant-design/icons/ReloadOutlined";
import type { QcIssue, QcReport } from "@welllog/ts-api-client";
import { Alert, Button, Empty, Spin, Tag, Typography } from "antd";

interface QualityControlPanelProps {
  readonly report: QcReport | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedCurveId: string;
  readonly onIssueSelect: (issue: QcIssue) => void;
  readonly onReload: () => void;
}

const severityLabels = {
  error: "Error",
  warning: "Warning",
  info: "Info",
} as const;

const severityColors = {
  error: "error",
  warning: "warning",
  info: "processing",
} as const;

export function QualityControlPanel({
  report,
  loading,
  error,
  selectedCurveId,
  onIssueSelect,
  onReload,
}: QualityControlPanelProps) {
  const summary = report?.summary;
  const status = summary?.error_count
    ? "Errors found"
    : summary?.warning_count
      ? "Review warnings"
      : "Checks passed";

  return (
    <div className="inspector-tab-scroll qc-panel">
      <header className="qc-summary-card">
        <div>
          <Typography.Text className="section-label">Dataset quality</Typography.Text>
          <strong>{status}</strong>
          <span>
            {summary
              ? `${summary.checks_run.toLocaleString()} checks · ${summary.issue_count.toLocaleString()} issues`
              : "Quality checks have not completed."}
          </span>
        </div>
        <Button
          aria-label="Run quality-control checks again"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={onReload}
          shape="circle"
          type="text"
        />
      </header>

      {summary ? (
        <div className="qc-count-grid" aria-label="Quality-control issue counts">
          <QcCount label="Errors" value={summary.error_count} tone="error" />
          <QcCount label="Warnings" value={summary.warning_count} tone="warning" />
          <QcCount label="Info" value={summary.info_count} tone="info" />
        </div>
      ) : null}

      {error ? <Alert message={error} showIcon type="error" /> : null}
      {loading && !report ? <Spin className="qc-loading" size="small" /> : null}
      {!loading && report?.issues.length === 0 ? (
        <Empty
          description="No issues found"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : null}

      <div className="qc-issue-list">
        {report?.issues.map((issue, index) => (
          <button
            className={`qc-issue-card${issue.curve_id === selectedCurveId ? " is-current" : ""}`}
            key={`${issue.code}:${issue.curve_id ?? "dataset"}:${index}`}
            onClick={() => onIssueSelect(issue)}
            type="button"
          >
            <div className="qc-issue-heading">
              <Tag color={severityColors[issue.severity]}>
                {severityLabels[issue.severity]}
              </Tag>
              <span>{issue.curve_mnemonic ?? "Dataset index"}</span>
            </div>
            <strong>{formatRuleName(issue.code)}</strong>
            <p>{issue.message}</p>
            {issue.index_minimum != null ? (
              <small>
                Index {formatIndex(issue.index_minimum)}
                {issue.index_maximum != null &&
                issue.index_maximum !== issue.index_minimum
                  ? ` — ${formatIndex(issue.index_maximum)}`
                  : ""}
              </small>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function QcCount({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: "error" | "warning" | "info";
}) {
  return (
    <div className={`qc-count is-${tone}`}>
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatRuleName(code: string): string {
  return code
    .replace(/^(CURVE|INDEX)_/, "")
    .split("_")
    .map((part) => `${part.charAt(0)}${part.slice(1).toLocaleLowerCase()}`)
    .join(" ");
}

function formatIndex(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}
