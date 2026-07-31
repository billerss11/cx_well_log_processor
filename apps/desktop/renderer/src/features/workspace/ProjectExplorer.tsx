import SearchOutlined from "@ant-design/icons/SearchOutlined";
import { Input, Tree, Typography, type TreeDataNode } from "antd";
import { useMemo, useState } from "react";

import { curves } from "./demoData";

function createProjectTreeData(filterTerm: string): TreeDataNode[] {
  const normalizedFilter = filterTerm.trim().toLocaleLowerCase();
  const visibleCurves = normalizedFilter
    ? curves.filter((curve) =>
        `${curve.mnemonic} ${curve.description} ${curve.unit}`
          .toLocaleLowerCase()
          .includes(normalizedFilter),
      )
    : curves;

  return [
    {
      key: "project",
      title: "Delaware Basin study",
      children: [
        {
          key: "well",
          title: "Orion A-12",
          children: [
            {
              key: "wellbore",
              title: "Main bore",
              children: [
                {
                  key: "dataset",
                  title: "Main pass · 2024-06-18",
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
                {
                  key: "formation-tops",
                  title: "Formation tops",
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
  readonly selectedCurveId: string;
  readonly onCurveSelect: (curveId: string) => void;
}

export function ProjectExplorer({
  selectedCurveId,
  onCurveSelect,
}: ProjectExplorerProps) {
  const [filterTerm, setFilterTerm] = useState("");
  const projectTreeData = useMemo(
    () => createProjectTreeData(filterTerm),
    [filterTerm],
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
              curves.some((curve) => curve.id === selectedKey)
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
          <strong>orion_a12_main.las</strong>
          <span>24,081 rows · referenced source</span>
        </div>
      </div>
    </aside>
  );
}
