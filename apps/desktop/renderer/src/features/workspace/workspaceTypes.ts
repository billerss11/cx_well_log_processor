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
  readonly previewSamples: readonly CurveSample[];
}

export interface WorkspaceDataset {
  readonly id: string;
  readonly projectName: string;
  readonly wellName: string;
  readonly fieldName: string;
  readonly datasetName: string;
  readonly sourceFile: string;
  readonly sourceFormat: "LAS";
  readonly lasVersion: string;
  readonly rowCount: number;
  readonly depthMnemonic: string;
  readonly depthUnit: string;
  readonly depthMinimum: number;
  readonly depthMaximum: number;
  readonly curves: readonly CurveDefinition[];
  readonly warnings: readonly string[];
}

export function findCurve(
  curves: readonly CurveDefinition[],
  curveId: string,
): CurveDefinition {
  const firstCurve = curves[0];
  if (!firstCurve) {
    throw new Error("The workspace dataset does not contain any curves.");
  }
  return curves.find((curve) => curve.id === curveId) ?? firstCurve;
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
