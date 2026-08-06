import type { QcReport } from "@welllog/ts-api-client";
import { useCallback, useEffect, useState } from "react";

import { getDatasetQc } from "../services/engineApi";

export interface DatasetQcState {
  readonly report: QcReport | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

export function useDatasetQc(
  documentId: string | undefined,
  datasetId: string | undefined,
): DatasetQcState {
  const [report, setReport] = useState<QcReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!documentId || !datasetId) {
      setReport(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    setReport(null);
    void getDatasetQc(documentId, datasetId)
      .then((nextReport) => {
        if (!cancelled) {
          setReport(nextReport);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setReport(null);
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not run quality-control checks.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [datasetId, documentId, revision]);

  return { report, loading, error, reload };
}
