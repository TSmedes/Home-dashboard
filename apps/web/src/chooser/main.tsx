import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { followSystemTheme } from "../lib/systemTheme.js";
import { Chooser } from "./Chooser.js";
import { localStore, savedStart } from "./start.js";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/chooser.css";

// A device that has been told where to go goes there without drawing anything.
const start = savedStart(localStore(), window.location.search);
if (start) {
  window.location.replace(start);
} else {
  followSystemTheme();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Chooser />
    </StrictMode>,
  );
}
