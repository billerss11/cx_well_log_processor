import SearchOutlined from "@ant-design/icons/SearchOutlined";
import { Input, Tree, Typography, type TreeDataNode } from "antd";
import { useMemo, useState } from "react";

import type { WorkspaceDataset } from "./workspaceTypes";

function createProjectTreeData(
  dataset: WorkspaceDataset,
  filterTerm: string,
): TreeDataNode[] {
  const normalizedFilter = filterTerm.trim().toLocaleLowerCase();
  const visibleCurves = normalizedFilter
    ? dataset.curves.filter((curve) =>
        `${curve.mnemonic} ${curve.description} ${curve.unit}`
          .toLocaleLowerCase()
          .includes(normalizedFilter),
      )
    : dataset.curves;

  return [
    {
      key: "project",
      title: dataset.projectName,
      children: [
        {
          key: "well",
          title: dataset.wellName,
          children: [
            {
              key: "wellbore",
              title: "Imported wellbore",
              children: [
                {
                  key: "dataset",
                  title: dataset.datasetName,
                  children: visibleCurves.map((curve) => ({
                    key: curve.id,
                    title: (
                      <span className="curve-tree-label">
                        <span
                          aria-hidden="true"
                          className="curve-swatch"
                          style={{ backgroundColor: curve.color }}
                        />
                        <span>{curve.mnemonic}</span>
                        <span className="curve-tree-unit">{curve.unit}</span>
                      </span>
                    ),
                  })),
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

interface ProjectExplorerProps {
  readonly dataset: WorkspaceDataset;
  readonly selectedCurveId: string;
  readonly onCurveSelect: (curveId: string) => void;
}

export function ProjectExplorer({
  dataset,
  selectedCurveId,
  onCurveSelect,
}: ProjectExplorerProps) {
  const [filterTerm, setFilterTerm] = useState("");
  const projectTreeData = useMemo(
    () => createProjectTreeData(dataset, filterTerm),
    [dataset, filterTerm],
  );

  return (
    <aside className="project-pane" aria-label="Project explorer">
      <div className="pane-heading">
        <div>
          <Typography.Text className="pane-eyebrow">
            Project explorer
          </Typography.Text>
          <Typography.Title level={2}>Local workspace</Typography.Title>
        </div>
      </div>

      <Input
        allowClear
        aria-label="Filter project"
        className="project-filter"
        onChange={(event) => setFilterTerm(event.target.value)}
        placeholder="Filter curves"
        prefix={<SearchOutlined aria-hidden="true" />}
        value={filterTerm}
      />

      <div className="project-tree-scroll">
        <Tree
          blockNode
          defaultExpandAll
          onSelect={(selectedKeys) => {
            const selectedKey = selectedKeys[0];
            if (
              typeof selectedKey === "string" &&
              dataset.curves.some((curve) => curve.id === selectedKey)
            ) {
              onCurveSelect(selectedKey);
            }
          }}
          selectedKeys={[selectedCurveId]}
          treeData={projectTreeData}
        />
      </div>

      <div className="source-summary">
        <span aria-hidden="true" className="source-file-mark">
          LAS
        </span>
        <div>
          <strong>{dataset.sourceFile}</strong>
          <span>
            {dataset.rowCount.toLocaleString()} rows · loaded in session
          </span>
        </div>
      </div>
    </aside>
  );
}
