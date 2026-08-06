import type { QcReport } from "@welllog/ts-api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { QualityControlPanel } from "./QualityControlPanel";

afterEach(cleanup);

test("summarizes QC results and opens the selected issue", () => {
  const onIssueSelect = vi.fn();
  const report: QcReport = {
    dataset_id: "dataset-1",
    document_id: "document-1",
    summary: {
      checks_run: 10,
      error_count: 1,
      info_count: 0,
      issue_count: 1,
      warning_count: 0,
    },
    issues: [
      {
        code: "INDEX_NON_MONOTONIC",
        curve_id: "gr",
        curve_mnemonic: "GR",
        evidence: { reversal_count: 1 },
        index_maximum: 101,
        index_minimum: 100,
        message: "The canonical index reverses direction once.",
        scope: "dataset",
        severity: "error",
      },
    ],
  };

  render(
    <QualityControlPanel
      error={null}
      loading={false}
      onIssueSelect={onIssueSelect}
      onReload={vi.fn()}
      report={report}
      selectedCurveId="gr"
    />,
  );

  expect(screen.getByText("Errors found")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /canonical index reverses/i }));
  expect(onIssueSelect).toHaveBeenCalledWith(report.issues[0]);
});
