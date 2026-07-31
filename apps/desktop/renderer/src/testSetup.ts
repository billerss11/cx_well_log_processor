import { vi } from "vitest";

class MockResizeObserver implements ResizeObserver {
  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })),
  writable: true,
});
