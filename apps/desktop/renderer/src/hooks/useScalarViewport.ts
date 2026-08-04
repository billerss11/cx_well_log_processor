import {
  ArrowDataClient,
  chunkCurveIds,
  type ScalarSample,
} from "@welllog/arrow-data-client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

const arrowClient = new ArrowDataClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765",
});
const totalPointBudget = 12_000;

interface IndexRange {
  readonly minimum: number;
  readonly maximum: number;
}

interface ScalarViewportState {
  readonly samplesByCurve: ReadonlyMap<string, readonly ScalarSample[]>;
  readonly loading: boolean;
  readonly error: string | null;
}

export function useScalarViewport(
  documentId: string,
  datasetId: string,
  curveIds: readonly string[],
  visibleRange: IndexRange,
  viewportHeight: number,
): ScalarViewportState {
  const [samplesByCurve, setSamplesByCurve] = useState<
    ReadonlyMap<string, readonly ScalarSample[]>
  >(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const requestSequence = useRef(0);
  const curveKey = curveIds.join("\u001f");
  const stableCurveIds = useMemo(
    () => (curveKey ? curveKey.split("\u001f") : []),
    [curveKey],
  );

  useEffect(() => {
    if (stableCurveIds.length === 0) {
      setSamplesByCurve(new Map());
      setLoading(false);
      setError(null);
      return;
    }

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const batches = chunkCurveIds(stableCurveIds);
      void Promise.all(
        batches.map((batch) =>
          arrowClient.visibleRange(
            documentId,
            datasetId,
            {
              curveIds: batch,
              indexMaximum: visibleRange.maximum,
              indexMinimum: visibleRange.minimum,
              pointBudget: Math.max(
                100,
                Math.floor(
                  (totalPointBudget * batch.length) / stableCurveIds.length,
                ),
              ),
              viewportHeight: Math.max(100, viewportHeight),
            },
            controller.signal,
          ),
        ),
      )
        .then((batchSamples) => {
          if (sequence !== requestSequence.current) {
            return;
          }
          const grouped = new Map<string, ScalarSample[]>();
          for (const sample of batchSamples.flat()) {
            const curveSamples = grouped.get(sample.curveId) ?? [];
            curveSamples.push(sample);
            grouped.set(sample.curveId, curveSamples);
          }
          startTransition(() => setSamplesByCurve(grouped));
        })
        .catch((requestError: unknown) => {
          if (requestError instanceof DOMException && requestError.name === "AbortError") {
            return;
          }
          if (sequence === requestSequence.current) {
            setError(
              requestError instanceof Error
                ? requestError.message
                : "Could not load the visible scalar range.",
            );
          }
        })
        .finally(() => {
          if (sequence === requestSequence.current) {
            setLoading(false);
          }
        });
    }, 160);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    curveKey,
    datasetId,
    documentId,
    startTransition,
    stableCurveIds,
    viewportHeight,
    visibleRange.maximum,
    visibleRange.minimum,
  ]);

  return { error, loading, samplesByCurve };
}
