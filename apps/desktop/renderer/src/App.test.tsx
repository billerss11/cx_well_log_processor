import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

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
}));

afterEach(cleanup);

test("shows the shared engine version", async () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: "CX Well Log Processor" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("Engine 0.1.0 · API v1"),
  ).toBeInTheDocument();
});

test("selects a curve and updates its details", () => {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "RT" }));

  const inspector = screen.getByRole("complementary", {
    name: "Curve inspector",
  });
  expect(
    within(inspector).getByRole("heading", { name: "RT" }),
  ).toBeInTheDocument();
  expect(within(inspector).getByText("Deep resistivity")).toBeInTheDocument();
});
