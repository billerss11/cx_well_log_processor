import SearchOutlined from "@ant-design/icons/SearchOutlined";
import { Input, Tree, Typography, type TreeDataNode } from "antd";
import { useMemo, useState } from "react";

import type { WorkspaceDocument } from "./workspaceTypes";

function createDocumentTreeData(
  document: WorkspaceDocument,
  filterTerm: string,
): TreeDataNode[] {
  const normalizedFilter = filterTerm.trim().toLocaleLowerCase();
  return [
    {
      key: "document",
      title: document.fieldName,
      children: document.datasets.map((dataset) => ({
        key: dataset.id,
        title: `${dataset.wellName} · ${dataset.name}`,
        children: dataset.curves
          .filter(
            (curve) =>
              !normalizedFilter ||
              `${curve.mnemonic} ${curve.description} ${curve.unit}`
                .toLocaleLowerCase()
                .includes(normalizedFilter),
          )
          .map((curve) => ({
            disabled:
              curve.previewSamples.length === 0 ||
              dataset.indexMinimum === null ||
              dataset.indexMaximum === null,
            key: `${dataset.id}:${curve.id}`,
            title: (
              <span className="curve-tree-label">
                <span
                  aria-hidden="true"
                  className="curve-swatch"
                  style={{ backgroundColor: curve.color }}
                />
                <span>{curve.mnemonic}</span>
                <span className="curve-tree-unit">
                  {curve.sampleShape.length > 0 ? "array" : curve.unit}
                </span>
              </span>
            ),
          })),
      })),
    },
  ];
}

interface ProjectExplorerProps {
  readonly document: WorkspaceDocument;
  readonly selectedDatasetId: string;
  readonly selectedCurveId: string;
  readonly onCurveSelect: (datasetId: string, curveId: string) => void;
}

export function ProjectExplorer({
  document,
  selectedDatasetId,
  selectedCurveId,
  onCurveSelect,
}: ProjectExplorerProps) {
  const [filterTerm, setFilterTerm] = useState("");
  const treeData = useMemo(
    () => createDocumentTreeData(document, filterTerm),
    [document, filterTerm],
  );

  return (
    <aside className="project-pane" aria-label="Document explorer">
      <div className="pane-heading">
        <div>
          <Typography.Text className="pane-eyebrow">
            Document explorer
          </Typography.Text>
          <Typography.Title level={2}>Imported content</Typography.Title>
        </div>
      </div>

      <Input
        allowClear
        aria-label="Filter curves"
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
            if (typeof selectedKey !== "string" || !selectedKey.includes(":")) {
              return;
            }
            const separator = selectedKey.indexOf(":");
            onCurveSelect(
              selectedKey.slice(0, separator),
              selectedKey.slice(separator + 1),
            );
          }}
          selectedKeys={
            selectedDatasetId && selectedCurveId
              ? [`${selectedDatasetId}:${selectedCurveId}`]
              : []
          }
          treeData={treeData}
        />
      </div>

      <div className="source-summary">
        <span aria-hidden="true" className="source-file-mark">
          {document.sourceFormat}
        </span>
        <div>
          <strong>{document.sourceFile}</strong>
          <span>
            {document.datasets.length.toLocaleString()} datasets · {document.saved ? "saved" : "session"}
          </span>
        </div>
      </div>
    </aside>
  );
}
