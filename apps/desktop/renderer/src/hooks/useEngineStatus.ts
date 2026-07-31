import { useEffect, useState } from "react";

import { getEngineHealth } from "../services/engineApi";

export interface EngineStatus {
  readonly label: string;
  readonly available: boolean;
}

export function useEngineStatus(): EngineStatus {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({
    label: "Checking local engine...",
    available: false,
  });

  useEffect(() => {
    let active = true;

    void getEngineHealth().then(({ data, error }) => {
      if (!active) {
        return;
      }

      if (error || !data) {
        setEngineStatus({
          label: "Local engine is unavailable",
          available: false,
        });
        return;
      }

      setEngineStatus({
        label: `Engine ${data.engine_version} · API ${data.api_version}`,
        available: true,
      });
    });

    return () => {
      active = false;
    };
  }, []);

  return engineStatus;
}
