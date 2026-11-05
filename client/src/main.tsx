import { createRoot } from "react-dom/client";
import { Chat } from "./chat.js";
import { Dashboard } from "./dashboard.js";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  window.location.pathname === "/assistant" ? <Chat /> : <Dashboard />,
);
