export interface CurveSample {
  readonly depth: number;
  readonly value: number | null;
}

export interface CurveDefinition {
  readonly id: string;
  readonly mnemonic: string;
  readonly description: string;
  readonly unit: string;
  readonly color: string;
  readonly scale: "Linear" | "Logarithmic";
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly sampleCount: number;
  readonly nullCount: number;
  readonly sampleShape: readonly number[];
  readonly storageKind: "parquet" | "zarr" | "metadata_only";
  readonly previewSamples: readonly CurveSample[];
}

export interface WorkspaceDataset {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly wellName: string;
  readonly wellboreName: string;
  readonly rowCount: number;
  readonly indexMnemonic: string;
  readonly indexUnit: string;
  readonly indexKind: "measured_depth" | "time" | "sample" | "other";
  readonly indexMinimum: number | null;
  readonly indexMaximum: number | null;
  readonly curves: readonly CurveDefinition[];
}

export interface WorkspaceDocument {
  readonly id: string;
  readonly sourceFile: string;
  readonly sourceFormat: "LAS" | "DLIS" | "WITSML";
  readonly sourceVersion: string;
  readonly fieldName: string;
  readonly saved: boolean;
  readonly preservedObjectCount: number;
  readonly datasets: readonly WorkspaceDataset[];
  readonly warnings: readonly string[];
}

export function findCurve(
  curves: readonly CurveDefinition[],
  curveId: string,
): CurveDefinition {
  const displayableCurves = curves.filter(
    (curve) => curve.previewSamples.length > 0,
  );
  const firstCurve = displayableCurves[0];
  if (!firstCurve) {
    throw new Error("This dataset does not contain scalar preview curves.");
  }
  return displayableCurves.find((curve) => curve.id === curveId) ?? firstCurve;
}

export function findFirstDisplayableDataset(
  document: WorkspaceDocument,
): WorkspaceDataset | undefined {
  return document.datasets.find(
    (dataset) =>
      dataset.indexMinimum !== null &&
      dataset.indexMaximum !== null &&
      dataset.indexMaximum > dataset.indexMinimum &&
      dataset.curves.some((curve) => curve.previewSamples.length > 0),
  );
}

export function formatCurveValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const absoluteValue = Math.abs(value);
  if ((absoluteValue > 0 && absoluteValue < 0.01) || absoluteValue >= 10_000) {
    return value.toExponential(2);
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function findNearestCurveValue(
  curve: CurveDefinition,
  depth: number,
): number | null {
  let nearestValue: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const sample of curve.previewSamples) {
    if (sample.value === null) {
      continue;
    }
    const distance = Math.abs(sample.depth - depth);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestValue = sample.value;
    }
  }

  return nearestValue;
}
