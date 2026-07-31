import { theme, type ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  algorithm: [theme.defaultAlgorithm, theme.compactAlgorithm],
  token: {
    colorPrimary: "#1f6f68",
    colorInfo: "#1f6f68",
    colorSuccess: "#3f7d5a",
    colorWarning: "#b46f32",
    colorError: "#a65252",
    colorText: "#1d292a",
    colorTextSecondary: "#667173",
    colorBgBase: "#f2f4f1",
    colorBgContainer: "#fafbf8",
    colorBorder: "#d9dfda",
    colorSplit: "#e3e7e2",
    borderRadius: 12,
    borderRadiusLG: 16,
    controlHeight: 34,
    fontFamily:
      '"Plus Jakarta Sans Variable", "Segoe UI Variable", ui-sans-serif, sans-serif',
    fontFamilyCode:
      '"JetBrains Mono Variable", "Cascadia Mono", ui-monospace, monospace',
    fontSize: 13,
    motionEaseInOut:
      "cubic-bezier(0.32, 0.72, 0, 1)",
    motionEaseOut:
      "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  components: {
    Button: {
      borderRadius: 999,
      controlHeight: 34,
      fontWeight: 650,
      primaryShadow: "0 8px 22px rgb(31 111 104 / 18%)",
    },
    Input: {
      activeShadow: "0 0 0 3px rgb(31 111 104 / 10%)",
      borderRadius: 10,
    },
    Tabs: {
      horizontalItemPadding: "10px 2px",
      horizontalItemGutter: 24,
      inkBarColor: "#1f6f68",
      itemActiveColor: "#1f6f68",
      itemSelectedColor: "#1d292a",
    },
    Tree: {
      directoryNodeSelectedBg: "#deebe7",
      nodeHoverBg: "#edf2ef",
      nodeSelectedBg: "#deebe7",
      titleHeight: 28,
    },
  },
};
