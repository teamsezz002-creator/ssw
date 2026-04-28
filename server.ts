import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import apiRouter from "./api/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Logging middleware to debug 404s
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // Serve tracking.js
  app.use(express.static(path.join(process.cwd(), "public")));

  // Mount API router
  app.use("/api", apiRouter);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      console.log(`[Server] Serving production static files from: ${distPath}`);
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        if (req.url.startsWith('/api/')) {
          console.warn(`[API] 404 Not Found: ${req.method} ${req.url}`);
          return res.status(404).json({ error: "API endpoint not found" });
        }
        console.log(`[Fallback] Serving index.html for: ${req.url}`);
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      console.error(`[Server] Critical Error: dist folder not found at ${distPath}. Build might have failed.`);
      app.get("*", (req, res) => {
        res.status(500).send("Application not built. Please run npm run build.");
      });
    }
  }

  // Global Error Handler for API routes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global error handler:", err);
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ error: err.message || "Internal server error" });
    } else {
      next(err);
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
