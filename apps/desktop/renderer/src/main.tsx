import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/plus-jakarta-sans";

import { App as AntDesignApp, ConfigProvider } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { appTheme } from "./theme";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ConfigProvider theme={appTheme}>
      <AntDesignApp>
        <App />
      </AntDesignApp>
    </ConfigProvider>
  </StrictMode>,
);
