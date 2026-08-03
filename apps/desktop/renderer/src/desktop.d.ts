interface WelllogDesktopApi {
  readonly platform: string;
  readonly selectWellLogFile: () => Promise<string | null>;
  readonly selectCxlogDestination: (
    defaultName: string,
  ) => Promise<string | null>;
  readonly versions: {
    readonly electron: string;
  };
}

interface Window {
  readonly welllogDesktop: WelllogDesktopApi;
}
