import { client, getHealth } from "@welllog/ts-api-client";
import { useEffect, useState } from "react";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765";

client.setConfig({ baseUrl: apiBaseUrl });

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

    void getHealth().then(({ data, error }) => {
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
