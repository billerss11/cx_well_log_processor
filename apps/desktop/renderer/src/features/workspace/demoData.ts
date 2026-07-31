import type {
  CurveDefinition,
  CurveSample,
  WorkspaceDataset,
} from "./workspaceTypes";

const depthMinimum = 2300;
const depthMaximum = 2420;
const pointCount = 480;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createSamples(
  getValue: (depth: number) => number,
  toDisplayValue: (normalizedValue: number) => number,
): readonly CurveSample[] {
  return Array.from({ length: pointCount + 1 }, (_, index) => {
    const depth =
      depthMinimum + (index / pointCount) * (depthMaximum - depthMinimum);
    return {
      depth,
      value: toDisplayValue(getValue(depth)),
    };
  });
}

function gammaValue(depth: number): number {
  const position = (depth - depthMinimum) * 2;
  return clamp(
    0.49 +
      Math.sin(position * 0.12) * 0.19 +
      Math.sin(position * 0.031 + 1.7) * 0.13 +
      Math.sin(position * 0.37) * 0.035,
  );
}

function resistivityValue(depth: number): number {
  const position = (depth - depthMinimum) * 2;
  const bedResponse =
    depth > 2330 && depth < 2351
      ? 0.23
      : depth > 2380 && depth < 2393
        ? 0.16
        : 0;
  return clamp(
    0.38 +
      Math.sin(position * 0.075 + 0.8) * 0.12 +
      Math.sin(position * 0.24) * 0.045 +
      bedResponse,
  );
}

function densityValue(depth: number): number {
  const position = (depth - depthMinimum) * 2;
  return clamp(
    0.56 +
      Math.sin(position * 0.095 + 2.3) * 0.12 +
      Math.sin(position * 0.28) * 0.028,
  );
}

function neutronValue(depth: number): number {
  const position = (depth - depthMinimum) * 2;
  const crossover = depth > 2334 && depth < 2346 ? 0.14 : 0;
  return clamp(
    0.48 -
      Math.sin(position * 0.089 + 2.1) * 0.11 -
      Math.sin(position * 0.25) * 0.025 -
      crossover,
  );
}

const curves = [
  {
    id: "curve-gr",
    mnemonic: "GR",
    description: "Gamma ray",
    unit: "gAPI",
    color: "#628d4e",
    scale: "Linear",
    minimum: 0,
    maximum: 150,
    sampleCount: 24_081,
    nullCount: 72,
    previewSamples: createSamples(gammaValue, (value) => value * 150),
  },
  {
    id: "curve-rt",
    mnemonic: "RT",
    description: "Deep resistivity",
    unit: "ohm·m",
    color: "#b86442",
    scale: "Logarithmic",
    minimum: 0.2,
    maximum: 2000,
    sampleCount: 24_081,
    nullCount: 88,
    previewSamples: createSamples(
      resistivityValue,
      (value) => 0.2 * Math.pow(10_000, value),
    ),
  },
  {
    id: "curve-rhob",
    mnemonic: "RHOB",
    description: "Bulk density",
    unit: "g/cm³",
    color: "#625aa3",
    scale: "Linear",
    minimum: 1.95,
    maximum: 2.95,
    sampleCount: 24_081,
    nullCount: 64,
    previewSamples: createSamples(densityValue, (value) => 1.95 + value),
  },
  {
    id: "curve-nphi",
    mnemonic: "NPHI",
    description: "Neutron porosity",
    unit: "v/v",
    color: "#3f7d8c",
    scale: "Linear",
    minimum: -0.15,
    maximum: 0.45,
    sampleCount: 24_081,
    nullCount: 73,
    previewSamples: createSamples(
      neutronValue,
      (value) => 0.45 - value * 0.6,
    ),
  },
] as const satisfies readonly CurveDefinition[];

export const demoDataset: WorkspaceDataset = {
  id: "demo-orion-a12",
  projectName: "Delaware Basin study",
  wellName: "Orion A-12",
  fieldName: "Delaware Basin",
  datasetName: "Main pass · 2024-06-18",
  sourceFile: "orion_a12_main.las",
  sourceFormat: "LAS",
  lasVersion: "2.0",
  rowCount: 24_081,
  depthMnemonic: "DEPT",
  depthUnit: "m",
  depthMinimum,
  depthMaximum,
  curves,
  warnings: [],
};
