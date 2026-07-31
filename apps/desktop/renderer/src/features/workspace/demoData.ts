export interface CurveDefinition {
  readonly id: string;
  readonly mnemonic: string;
  readonly description: string;
  readonly unit: string;
  readonly color: string;
  readonly scale: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly currentValue: string;
  readonly sampleCount: string;
}

export const curves = [
  {
    id: "curve-gr",
    mnemonic: "GR",
    description: "Gamma ray",
    unit: "gAPI",
    color: "#628d4e",
    scale: "Linear",
    minimum: "0",
    maximum: "150",
    currentValue: "68.4",
    sampleCount: "24,081",
  },
  {
    id: "curve-rt",
    mnemonic: "RT",
    description: "Deep resistivity",
    unit: "ohm·m",
    color: "#b86442",
    scale: "Logarithmic",
    minimum: "0.2",
    maximum: "2,000",
    currentValue: "37.8",
    sampleCount: "24,081",
  },
  {
    id: "curve-rhob",
    mnemonic: "RHOB",
    description: "Bulk density",
    unit: "g/cm³",
    color: "#625aa3",
    scale: "Linear",
    minimum: "1.95",
    maximum: "2.95",
    currentValue: "2.41",
    sampleCount: "24,081",
  },
  {
    id: "curve-nphi",
    mnemonic: "NPHI",
    description: "Neutron porosity",
    unit: "v/v",
    color: "#3f7d8c",
    scale: "Linear",
    minimum: "0.45",
    maximum: "-0.15",
    currentValue: "0.18",
    sampleCount: "24,081",
  },
] as const satisfies readonly CurveDefinition[];

export const defaultCurveId = "curve-gr";

export function findCurve(curveId: string): CurveDefinition {
  return curves.find((curve) => curve.id === curveId) ?? curves[0];
}
