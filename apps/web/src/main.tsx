import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { EditProvider } from "./edit/EditContext.js";
import { DashboardProvider } from "./lib/dashboard.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/expanded.css";
import "./styles/edit.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardProvider>
      <EditProvider>
        <App />
      </EditProvider>
    </DashboardProvider>
  </StrictMode>,
);
