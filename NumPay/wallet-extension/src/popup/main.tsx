// First import on purpose: kicks off the parallel storage preload (session,
// settings, balance caches) while the rest of the bundle is still evaluating.
import "./boot";
import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Apply saved theme before first render to prevent flash
document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem("numpay_theme") || "dark"
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter>
      <App />
    </MemoryRouter>
  </React.StrictMode>
);
