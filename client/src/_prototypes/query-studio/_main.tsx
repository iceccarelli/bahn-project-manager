// @ts-nocheck
// PROTOTYPE — NOT PART OF THE PRODUCTION BUILD
// Original entry point for the standalone prototype app.
// See client/src/_prototypes/README.md for rules.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./QueryStudio.tsx";
import "./_index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
