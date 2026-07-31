import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { App as AntDesignApp } from "antd";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "./App";

const selectLasFile = vi.fn<() => Promise<string | null>>();

vi.mock("@welllog/ts-api-client", () => ({
  client: {
    setConfig: vi.fn(),
  },
  getHealth: vi.fn().mockResolvedValue({
    data: {
      api_version: "v1",
      engine_version: "0.1.0",
      status: "ok",
    },
  }),
  importLas: vi.fn().mockResolvedValue({
    data: {
      curves: [
        {
          description: "Gamma Ray",
          id: "curve-1-gr",
          maximum: 145.2,
          minimum: 12.4,
          mnemonic: "GR",
          null_count: 3,
          preview_samples: [
            { depth: 1750, value: 86.2 },
            { depth: 2143, value: 74.1 },
          ],
          sample_count: 3931,
          unit: "gAPI",
        },
      ],
      depth_maximum: 2143,
      depth_minimum: 1750,
      depth_mnemonic: "DEPT",
      depth_unit: "m",
      field_name: "Geographe",
      file_size_bytes: 1_105_604,
      las_version: "2.0",
      row_count: 3931,
      source_file: "test.las",
      warnings: [],
      well_name: "Geographe 2 L1",
    },
  }),
}));

beforeEach(() => {
  selectLasFile.mockResolvedValue("J:\\sample\\test.las");
  Object.defineProperty(window, "welllogDesktop", {
    configurable: true,
    value: {
      platform: "win32",
      selectLasFile,
      versions: { electron: "43.2.0" },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <AntDesignApp>
      <App />
    </AntDesignApp>,
  );
}

test("shows the shared engine version", async () => {
  renderApp();

  expect(
    screen.getByRole("heading", { name: "CX Well Log Processor" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("Engine 0.1.0 · API v1"),
  ).toBeInTheDocument();
});

test("selects a curve and updates its details", () => {
  renderApp();

  fireEvent.click(screen.getByRole("button", { name: "RT" }));

  const inspector = screen.getByRole("complementary", {
    name: "Curve inspector",
  });
  expect(
    within(inspector).getByRole("heading", { name: "RT" }),
  ).toBeInTheDocument();
  expect(within(inspector).getByText("Deep resistivity")).toBeInTheDocument();
});

test("imports a selected LAS file into the workspace", async () => {
  renderApp();

  fireEvent.click(screen.getByRole("button", { name: /Import data/i }));

  expect(
    await screen.findByRole("heading", { name: "Geographe 2 L1" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("test.las").length).toBeGreaterThan(0);
  expect(selectLasFile).toHaveBeenCalledOnce();
});
