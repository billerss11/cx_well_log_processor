import ImportOutlined from "@ant-design/icons/ImportOutlined";
import SettingOutlined from "@ant-design/icons/SettingOutlined";
import {
  App as AntDesignApp,
  Button,
  Splitter,
  Tooltip,
  Typography,
} from "antd";
import { useState } from "react";

import "./app.css";
import { CurveInspector } from "./features/workspace/CurveInspector";
import { demoDataset } from "./features/workspace/demoData";
import { LogWorkspace } from "./features/workspace/LogWorkspace";
import { ProjectExplorer } from "./features/workspace/ProjectExplorer";
import { findCurve } from "./features/workspace/workspaceTypes";
import { useEngineStatus } from "./hooks/useEngineStatus";
import { useLasImport } from "./hooks/useLasImport";

export function App() {
  const { message } = AntDesignApp.useApp();
  const engineStatus = useEngineStatus();
  const { importing, selectAndImportLas } = useLasImport();
  const [dataset, setDataset] = useState(demoDataset);
  const [selectedCurveId, setSelectedCurveId] = useState(
    demoDataset.curves[0]?.id ?? "curve-gr",
  );
  const selectedCurve = findCurve(dataset.curves, selectedCurveId);
  const platform = window.welllogDesktop?.platform ?? "desktop";

  async function handleImport(): Promise<void> {
    try {
      const importedDataset = await selectAndImportLas();
      if (!importedDataset) {
        return;
      }

      const initialCurve =
        importedDataset.curves.find(
          (curve) => curve.mnemonic.toLocaleUpperCase() === "GR",
        ) ?? importedDataset.curves[0];
      if (!initialCurve) {
        throw new Error("The selected LAS file does not contain usable curves.");
      }
      setDataset(importedDataset);
      setSelectedCurveId(initialCurve.id);
      void message.success(
        `Imported ${importedDataset.sourceFile}: ${importedDataset.curves.length} curves.`,
      );
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "LAS import failed.",
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
              <Typography.Text className="brand-kicker">
                CX subsurface
              </Typography.Text>
              <Typography.Title level={1}>
                CX Well Log Processor
              </Typography.Title>
            </div>
          </div>

          <div className="project-context" aria-label="Current project">
            <span>Current project</span>
            <strong>{dataset.projectName}</strong>
            <small>{dataset.sourceFile}</small>
          </div>

          <div className="header-actions">
            <div
              className={
                engineStatus.available
                  ? "engine-status is-ready"
                  : "engine-status"
              }
              role="status"
            >
              <span aria-hidden="true" />
              {engineStatus.label}
            </div>
            <Tooltip title="Workspace settings">
              <Button
                aria-label="Workspace settings"
                icon={<SettingOutlined />}
                shape="circle"
                type="text"
              />
            </Tooltip>
            <Button
              className="primary-action"
              loading={importing}
              onClick={() => void handleImport()}
              type="primary"
            >
              <span>Import data</span>
              <span className="primary-action-icon" aria-hidden="true">
                <ImportOutlined />
              </span>
            </Button>
          </div>
        </header>
      </div>

      <div className="workbench-shell">
        <section className="workbench-core" aria-label="Well log workstation">
          <Splitter className="workspace-splitter" lazy>
            <Splitter.Panel
              className="workspace-panel project-panel"
              defaultSize={246}
              max={340}
              min={190}
            >
              <ProjectExplorer
                dataset={dataset}
                onCurveSelect={setSelectedCurveId}
                selectedCurveId={selectedCurveId}
              />
            </Splitter.Panel>
            <Splitter.Panel className="workspace-panel log-panel" min={420}>
              <LogWorkspace
                dataset={dataset}
                key={dataset.id}
                onCurveSelect={setSelectedCurveId}
                selectedCurveId={selectedCurveId}
              />
            </Splitter.Panel>
            <Splitter.Panel
              className="workspace-panel inspector-panel"
              defaultSize={286}
              max={380}
              min={220}
            >
              <CurveInspector curve={selectedCurve} dataset={dataset} />
            </Splitter.Panel>
          </Splitter>
        </section>
      </div>

      <footer className="app-statusbar">
        <div>
          <span
            aria-hidden="true"
            className={
              engineStatus.available ? "status-light is-ready" : "status-light"
            }
          />
          Local-only workspace
        </div>
        <div>
          {dataset.sourceFormat} · {dataset.wellName} ·{" "}
          {dataset.rowCount.toLocaleString()} rows
        </div>
        <div>
          {platform} · Electron {window.welllogDesktop?.versions.electron ?? "dev"}
        </div>
      </footer>
    </main>
  );
}
