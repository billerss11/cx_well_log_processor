export interface ScalarLogSample {
  readonly index: number;
  readonly value: number | null;
}

export interface ScalarLogCurve {
  readonly id: string;
  readonly mnemonic: string;
  readonly unit: string;
  readonly color: string;
  readonly scale: "linear" | "logarithmic";
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly samples: readonly ScalarLogSample[];
}

export interface ScalarLogViewport {
  readonly minimum: number;
  readonly maximum: number;
}

export interface ScalarLogRenderModel {
  readonly indexMnemonic: string;
  readonly indexUnit: string;
  readonly indexRange: ScalarLogViewport;
  readonly curves: readonly ScalarLogCurve[];
  readonly viewport: ScalarLogViewport;
  readonly cursorIndex: number;
  readonly selectedCurveId: string;
}

export interface ScalarLogRendererEvents {
  readonly onCursorChange: (index: number) => void;
  readonly onCurveSelect: (curveId: string) => void;
  readonly onViewportChange: (viewport: ScalarLogViewport) => void;
}

export interface ScalarLogRenderer {
  update(model: ScalarLogRenderModel): void;
  resize(): void;
  dispose(): void;
}
