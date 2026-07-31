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
import {
  defaultCurveId,
  findCurve,
} from "./features/workspace/demoData";
import { LogWorkspace } from "./features/workspace/LogWorkspace";
import { ProjectExplorer } from "./features/workspace/ProjectExplorer";
import { useEngineStatus } from "./hooks/useEngineStatus";

export function App() {
  const { message } = AntDesignApp.useApp();
  const engineStatus = useEngineStatus();
  const [selectedCurveId, setSelectedCurveId] = useState(defaultCurveId);
  const selectedCurve = findCurve(selectedCurveId);
  const platform = window.welllogDesktop?.platform ?? "desktop";

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
            <strong>Delaware Basin study</strong>
            <small>Saved locally</small>
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
              onClick={() => {
                void message.info(
                  "Import will open the native file picker in the next implementation step.",
                );
              }}
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
                onCurveSelect={setSelectedCurveId}
                selectedCurveId={selectedCurveId}
              />
            </Splitter.Panel>
            <Splitter.Panel className="workspace-panel log-panel" min={420}>
              <LogWorkspace
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
              <CurveInspector curve={selectedCurve} />
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
        <div>Demo dataset · Orion A-12 · Main bore</div>
        <div>
          {platform} · Electron {window.welllogDesktop?.versions.electron ?? "dev"}
        </div>
      </footer>
    </main>
  );
}
