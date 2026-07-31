interface WelllogDesktopApi {
  readonly platform: string;
  readonly versions: {
    readonly electron: string;
  };
}

interface Window {
  readonly welllogDesktop: WelllogDesktopApi;
}
