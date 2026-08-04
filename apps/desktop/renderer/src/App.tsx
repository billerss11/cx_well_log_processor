import CloseOutlined from "@ant-design/icons/CloseOutlined";
import FolderOpenOutlined from "@ant-design/icons/FolderOpenOutlined";
import SaveOutlined from "@ant-design/icons/SaveOutlined";
import SettingOutlined from "@ant-design/icons/SettingOutlined";
import {
  App as AntDesignApp,
  Button,
  Empty,
  Progress,
  Radio,
  Splitter,
  Tooltip,
  Typography,
} from "antd";
import { useState } from "react";

import "./app.css";
import { CurveInspector } from "./features/workspace/CurveInspector";
import { LogWorkspace } from "./features/workspace/LogWorkspace";
import { ProjectExplorer } from "./features/workspace/ProjectExplorer";
import {
  findFirstDisplayableDataset,
  isDisplayableCurve,
  type WorkspaceDocument,
} from "./features/workspace/workspaceTypes";
import { useDocument } from "./hooks/useDocument";
import { useEngineStatus } from "./hooks/useEngineStatus";

export function App() {
  const { message, modal } = AntDesignApp.useApp();
  const engineStatus = useEngineStatus();
  const operations = useDocument();
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedCurveId, setSelectedCurveId] = useState("");
  const [visibleCurveIds, setVisibleCurveIds] = useState<readonly string[]>([]);
  const activeDataset = document?.datasets.find(
    (dataset) => dataset.id === selectedDatasetId,
  );
  const selectedCurve = activeDataset?.curves.find(
    (curve) => curve.id === selectedCurveId,
  );
  const platform = window.welllogDesktop?.platform ?? "desktop";

  function selectInitialCurve(nextDocument: WorkspaceDocument): void {
    const dataset = findFirstDisplayableDataset(nextDocument);
    const curve =
      dataset?.curves.find(
        (item) =>
          isDisplayableCurve(item) &&
          item.mnemonic.toLocaleUpperCase() === "GR",
      ) ?? dataset?.curves.find(isDisplayableCurve);
    setSelectedDatasetId(dataset?.id ?? "");
    setSelectedCurveId(curve?.id ?? "");
    setVisibleCurveIds(
      dataset?.curves.filter(isDisplayableCurve).slice(0, 8).map((item) => item.id) ?? [],
    );
  }

  async function handleOpen(): Promise<void> {
    try {
      const openedDocument = await operations.selectAndOpenDocument(
        (candidates) =>
          new Promise((resolve) => {
            let selectedId = candidates[0]?.id ?? "";
            modal.confirm({
              cancelText: "Cancel import",
              content: (
                <Radio.Group
                  defaultValue={selectedId}
                  onChange={(event) => {
                    selectedId = String(event.target.value);
                  }}
                >
                  {candidates.map((candidate) => (
                    <Radio className="index-candidate" key={candidate.id} value={candidate.id}>
                      <strong>{candidate.mnemonic}</strong> {candidate.unit} · {candidate.kind}
                      <small>{candidate.reason}</small>
                    </Radio>
                  ))}
                </Radio.Group>
              ),
              onCancel: () => resolve(null),
              onOk: () => resolve(selectedId || null),
              okText: "Use selected index",
              title: "Choose the canonical index",
            });
          }),
      );
      if (!openedDocument) {
        return;
      }
      const previousDocumentId = document?.id;
      setDocument(openedDocument);
      selectInitialCurve(openedDocument);
      if (previousDocumentId && previousDocumentId !== openedDocument.id) {
        await operations.closeDocument(previousDocumentId);
      }
      void message.success(
        `Opened ${openedDocument.sourceFile}: ${openedDocument.datasets.length} datasets.`,
      );
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "Could not open the well log.",
      );
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (!document) {
      return;
    }
    try {
      const savedDocument = await operations.selectAndSaveDocument(document);
      if (!savedDocument) {
        return;
      }
      setDocument(savedDocument);
      void message.success("CX Log package saved.");
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "Could not save the CX Log package.",
      );
    }
  }

  async function handleClose(): Promise<void> {
    if (!document) {
      return;
    }
    try {
      await operations.closeDocument(document.id);
      setDocument(null);
      setSelectedDatasetId("");
      setSelectedCurveId("");
      setVisibleCurveIds([]);
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "Could not close the document.",
      );
    }
  }

  return (
    <main className="app-frame">
      <div className="app-ambient" aria-hidden="true" />

      <div className="app-header-shell">
        <header className="app-header">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div>
              <Typography.Text className="brand-kicker">CX subsurface</Typography.Text>
              <Typography.Title level={1}>CX Well Log Processor</Typography.Title>
            </div>
          </div>

          <div className="project-context" aria-label="Current document">
            <span>Current document</span>
            <strong>{document?.fieldName ?? "No document open"}</strong>
            <small>{document?.sourceFile ?? "LAS · DLIS · WITSML · CX Log"}</small>
          </div>

          <div className="header-actions">
            <div
              className={engineStatus.available ? "engine-status is-ready" : "engine-status"}
              role="status"
            >
              <span aria-hidden="true" />
              {engineStatus.label}
            </div>
            {operations.busy ? (
              <Tooltip title={operations.statusMessage}>
                <Progress
                  className="operation-progress"
                  percent={operations.progress}
                  showInfo={false}
                  size="small"
                />
              </Tooltip>
            ) : null}
            <Tooltip title="Workspace settings">
              <Button
                aria-label="Workspace settings"
                icon={<SettingOutlined />}
                shape="circle"
                type="text"
              />
            </Tooltip>
            {document ? (
              <>
                <Button
                  disabled={operations.busy}
                  icon={<SaveOutlined />}
                  onClick={() => void handleSaveAs()}
                >
                  Save As
                </Button>
                <Tooltip title="Close document">
                  <Button
                    aria-label="Close document"
                    disabled={operations.busy}
                    icon={<CloseOutlined />}
                    onClick={() => void handleClose()}
                    shape="circle"
                    type="text"
                  />
                </Tooltip>
              </>
            ) : null}
            <Button
              className="primary-action"
              icon={<FolderOpenOutlined />}
              loading={operations.busy}
              onClick={() => void handleOpen()}
              type="primary"
            >
              Open Well Log
            </Button>
          </div>
        </header>
      </div>

      <div className="workbench-shell">
        <section className="workbench-core" aria-label="Well log workstation">
          {document ? (
            <Splitter className="workspace-splitter" lazy>
              <Splitter.Panel
                className="workspace-panel project-panel"
                defaultSize={246}
                max={340}
                min={190}
              >
                <ProjectExplorer
                  document={document}
                  onCurveSelect={(datasetId, curveId) => {
                    if (datasetId !== selectedDatasetId) {
                      const nextDataset = document.datasets.find((item) => item.id === datasetId);
                      setVisibleCurveIds(
                        nextDataset?.curves.filter(isDisplayableCurve).slice(0, 8).map((item) => item.id) ?? [],
                      );
                    }
                    setSelectedDatasetId(datasetId);
                    setSelectedCurveId(curveId);
                  }}
                  onCurveVisibilityChange={(curveId, visible) => {
                    setVisibleCurveIds((current) =>
                      visible
                        ? current.includes(curveId) ? current : [...current, curveId]
                        : current.filter((id) => id !== curveId),
                    );
                  }}
                  selectedCurveId={selectedCurveId}
                  selectedDatasetId={selectedDatasetId}
                  visibleCurveIds={visibleCurveIds}
                />
              </Splitter.Panel>
              <Splitter.Panel className="workspace-panel log-panel" min={420}>
                {activeDataset && selectedCurve ? (
                  <LogWorkspace
                    dataset={activeDataset}
                    document={document}
                    key={activeDataset.id}
                    onCurveSelect={setSelectedCurveId}
                    onVisibleCurveIdsChange={setVisibleCurveIds}
                    selectedCurveId={selectedCurveId}
                    visibleCurveIds={visibleCurveIds}
                  />
                ) : (
                  <Empty
                    className="panel-empty"
                    description="This document has no scalar preview. Array data is preserved in CX Log."
                  />
                )}
              </Splitter.Panel>
              <Splitter.Panel
                className="workspace-panel inspector-panel"
                defaultSize={286}
                max={380}
                min={220}
              >
                {activeDataset && selectedCurve ? (
                  <CurveInspector
                    curve={selectedCurve}
                    dataset={activeDataset}
                    document={document}
                    busy={operations.busy}
                    onExport={async (allScalarCurves) => {
                      const exportedPath = await operations.selectAndExportCsv(
                        document,
                        activeDataset.id,
                        visibleCurveIds,
                        allScalarCurves,
                      );
                      if (exportedPath) {
                        void message.success(`CSV exported to ${exportedPath}`);
                      }
                    }}
                    onViewSettingsSave={async (settings) => {
                      try {
                        const updated = await operations.updateDatasetSettings(
                          document.id,
                          activeDataset.id,
                          settings,
                        );
                        setDocument(updated);
                        void message.success("View settings updated. Use Save As to persist them.");
                      } catch (error) {
                        void message.error(error instanceof Error ? error.message : "Could not update view settings.");
                      }
                    }}
                    visibleCurveIds={visibleCurveIds}
                  />
                ) : (
                  <Empty className="panel-empty" description="No scalar curve selected" />
                )}
              </Splitter.Panel>
            </Splitter>
          ) : (
            <div className="empty-workspace">
              <Empty description="Open a LAS, DLIS, WITSML, or CX Log file">
                <Button
                  icon={<FolderOpenOutlined />}
                  loading={operations.busy}
                  onClick={() => void handleOpen()}
                  type="primary"
                >
                  Open Well Log
                </Button>
              </Empty>
              {operations.busy ? (
                <div className="empty-progress" role="status">
                  <Progress percent={operations.progress} size="small" />
                  <span>{operations.statusMessage}</span>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <footer className="app-statusbar">
        <div>
          <span
            aria-hidden="true"
            className={engineStatus.available ? "status-light is-ready" : "status-light"}
          />
          Local-only workspace
        </div>
        <div>
          {document
            ? `${document.sourceFormat} · ${document.datasets.length} datasets · ${document.modified ? "modified" : document.saved ? "saved" : "unsaved"}`
            : "No document open"}
        </div>
        <div>
          {platform} · Electron {window.welllogDesktop?.versions.electron ?? "dev"}
        </div>
      </footer>
    </main>
  );
}
