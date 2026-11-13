import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AIChat } from "./components/AIChat";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import type { AIChatConfig } from "./lib/types";
import "./index.css";
import "./chat.css";

const config: AIChatConfig = {
  endpoint: "",
  apiKey: "",
  model: "",
  botName: "Lumia Chat",
  systemPrompt: "你是 Lumia Chat，一个准确、友好且乐于助人的 AI 助手。",
};

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AIChat
            config={config}
            pageId={1}
            center
            enableCustomApi
            enableArticles={false}
          />
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
