import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DashboardProvider } from "../lib/dashboard.js";
import { followSystemTheme } from "../lib/systemTheme.js";
import { LightsApp } from "./LightsApp.js";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/layout.css";
import "../styles/expanded.css";
import "../styles/lights.css";

followSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardProvider>
      <LightsApp />
    </DashboardProvider>
  </StrictMode>,
);
