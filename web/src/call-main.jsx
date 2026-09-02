import React from "react";
import ReactDOM from "react-dom/client";
import CallApp from "./components/CallApp.jsx";
import "./index.css";

// Отдельный вход для звонка (web/call.html → /call): своё окно, без модели.
ReactDOM.createRoot(document.getElementById("root")).render(<CallApp />);
