interface WelllogDesktopApi {
  readonly platform: string;
  readonly selectLasFile: () => Promise<string | null>;
  readonly versions: {
    readonly electron: string;
  };
}

interface Window {
  readonly welllogDesktop: WelllogDesktopApi;
}
