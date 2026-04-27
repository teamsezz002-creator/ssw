import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import unzipper from "unzipper";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const uploadDir = path.join(process.cwd(), "uploads");
  const simDir = path.join(uploadDir, "simulations");

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
  if (!fs.existsSync(simDir)) fs.mkdirSync(simDir);
  
  console.log(`[Server] Upload directory: ${uploadDir}`);
  console.log(`[Server] Simulations directory: ${simDir}`);
  try {
    const existingSims = fs.readdirSync(simDir);
    console.log(`[Server] Found ${existingSims.length} existing simulations:`, existingSims);
  } catch (e) {
    console.warn(`[Server] Could not list simulations directory`);
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  });

  const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (
        file.mimetype === "application/zip" || 
        file.mimetype === "application/x-zip-compressed" ||
        file.mimetype === "application/x-zip" ||
        file.mimetype === "multipart/x-zip" ||
        file.mimetype === "application/octet-stream" ||
        ext === ".zip"
      ) {
        cb(null, true);
      } else {
        cb(new Error(`Only .zip files are allowed. Received: ${file.mimetype} and extension: ${ext}`));
      }
    },
  });

  // Serve tracking.js
  app.get("/tracking.js", (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "tracking.js"));
  });

  // Upload and Extract
  app.post("/api/upload", (req, res, next) => {
    upload.single("simulation")(req, res, (err) => {
      if (err) {
        console.error("Multer Error:", err);
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  }, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const rawSimId = req.body.simId || `sim-${Date.now()}`;
      const simId = rawSimId.replace(/[^a-zA-Z0-9_-]/g, "-");
      const extractPath = path.join(simDir, simId);

      if (!fs.existsSync(extractPath)) fs.mkdirSync(extractPath, { recursive: true });

      await fs.createReadStream(req.file.path)
        .pipe(unzipper.Extract({ path: extractPath }))
        .promise();

      // Clean up zip file
      fs.unlinkSync(req.file.path);

      console.log(`[Server] Simulation ${simId} extracted. Checking for build requirement...`);

      // 1. Auto Build System (Vercel-like)
      const packageJsonPath = path.join(extractPath, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        console.log(`[Server] Detected package.json in ${simId}. Running build...`);
        try {
          const hasBuiltFolder = fs.existsSync(path.join(extractPath, "dist")) || fs.existsSync(path.join(extractPath, "build"));
          
          if (!hasBuiltFolder) {
            await execPromise(`npm install --production=false`, { cwd: extractPath, timeout: 300000 });
            await execPromise(`npm run build`, { cwd: extractPath, timeout: 300000 });
          }

          const distDir = fs.existsSync(path.join(extractPath, "dist")) ? "dist" : "build";
          const buildPath = path.join(extractPath, distDir);

          if (fs.existsSync(buildPath)) {
            console.log(`[Server] Build successful for ${simId}. Moving output to root.`);
            const buildItems = fs.readdirSync(buildPath);
            for (const item of buildItems) {
              const src = path.join(buildPath, item);
              const dest = path.join(extractPath, item);
              if (src === dest) continue;
              
              if (fs.existsSync(dest)) {
                fs.rmSync(dest, { recursive: true, force: true });
              }
              fs.renameSync(src, dest);
            }
          }
        } catch (buildError: any) {
          console.error(`[Server] Build failed for ${simId}:`, buildError.stderr || buildError.message);
        }
      }

      // Deep search for index.html if not at root
      const findEntryPoint = (dir: string): string | null => {
        const items = fs.readdirSync(dir);
        if (items.includes("index.html")) return path.join(dir, "index.html");
        
        for (const item of items) {
          const fullPath = path.join(dir, item);
          if (fs.statSync(fullPath).isDirectory()) {
            if (item === "node_modules" || item === ".git") continue;
            const found = findEntryPoint(fullPath);
            if (found) return found;
          }
        }
        return null;
      };

      let entryPointPath = findEntryPoint(extractPath);
      
      if (!entryPointPath) {
        return res.status(400).json({ error: "Zip does not contain an index.html file." });
      }

      const entryDir = path.dirname(entryPointPath);
      if (entryDir !== extractPath) {
        console.log(`[Server] Lifting content from ${entryDir} to ${extractPath}`);
        const items = fs.readdirSync(entryDir);
        for (const item of items) {
          const src = path.join(entryDir, item);
          const dest = path.join(extractPath, item);
          if (src === dest) continue;
          
          // Use a temporary name if dest already exists (unlikely in fresh extract)
          if (fs.existsSync(dest)) {
             try {
               if (fs.statSync(dest).isDirectory()) {
                 // Skip if it's the folder we are coming from
                 if (dest === entryDir) continue;
               }
             } catch(e) {}
          }
          fs.renameSync(src, dest);
        }
      }

      // Final check
      const indexPath = path.join(extractPath, "index.html");
      if (!fs.existsSync(indexPath)) {
        return res.status(400).json({ error: "Failed to locate index.html after extraction." });
      }

      // Inject tracking.js and fix absolute paths in index.html
      let html = fs.readFileSync(indexPath, "utf8");
      
      // Fix absolute paths (scripts, links, img) to be relative so it works in subdirectories
      // Replace src="/path" with src="path", etc.
      html = html.replace(/(src|href)="\/([^"]*)"/g, (match, attr, pathValue) => {
        // Skip purely root paths or external URLs if they somehow match
        if (!pathValue || pathValue.startsWith('http')) return match;
        // Don't break special cases like /tracking.js which we actually WANT from root or relative
        if (pathValue === 'tracking.js') return `${attr}="/${pathValue}"`;
        
        return `${attr}="${pathValue}"`;
      });

      if (!html.includes("tracking.js")) {
        const trackingScript = `\n<script src="/tracking.js"></script>`;
        if (html.includes("</body>")) {
          html = html.replace("</body>", `${trackingScript}</body>`);
        } else if (html.includes("</html>")) {
          html = html.replace("</html>", `${trackingScript}</html>`);
        } else {
          html += trackingScript;
        }
        fs.writeFileSync(indexPath, html);
      }

      console.log(`[Server] Simulation ${simId} extracted and tracking injected.`);

      res.json({
        success: true,
        simId,
        path: `/simulations/${simId}/index.html`,
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: error.message || "Failed to upload and extract simulation" });
    }
  });

  // Create a sample simulation for testing
  app.post("/api/create-sample", (req, res) => {
    const simId = "sample-lab-" + Math.floor(Math.random() * 1000);
    const extractPath = path.join(simDir, simId);
    
    try {
      if (!fs.existsSync(extractPath)) fs.mkdirSync(extractPath, { recursive: true });
      
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Physics Lab Demo</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #fafafa; padding: 40px; display: flex; flex-direction: column; align-items: center; }
        .box { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); text-align: center; max-width: 500px; border: 1px solid #eee; }
        h1 { color: #111; margin-bottom: 8px; }
        p { color: #666; margin-bottom: 24px; line-height: 1.5; }
        .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        button { background: #000; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: 600; transition: transform 0.1s; }
        button:hover { transform: scale(0.98); background: #222; }
        button.secondary { background: #eee; color: #000; }
        button.secondary:hover { background: #e5e5e5; }
        #status { margin-top: 20px; font-size: 14px; padding: 8px; border-radius: 4px; display: none; }
    </style>
</head>
<body>
    <div class="box">
        <h1>Gravity Experiment</h1>
        <p>A simple simulation to demonstrate real-time tracking and progress saving.</p>
        
        <div class="controls">
            <button onclick="startTrial()">Start Trial</button>
            <button onclick="solveQuestion()" class="secondary">Submit Answer</button>
            <button onclick="saveProgress()" class="secondary">Save State</button>
            <button onclick="finishSim()">Complete Simulation</button>
        </div>
        
        <div id="status"></div>
    </div>

    <script>
        function showStatus(msg, color = '#e0f2fe') {
            const el = document.getElementById('status');
            el.style.display = 'block';
            el.innerText = msg;
            el.style.background = color;
            setTimeout(() => { el.style.display = 'none'; }, 2000);
        }

        function startTrial() {
            showStatus('Experiment Started...');
            if (window.SimulationTracking) {
                window.SimulationTracking.trackStepComplete('experiment-setup');
            }
        }

        function solveQuestion() {
            const isCorrect = Math.random() > 0.3;
            showStatus(isCorrect ? 'Correct Answer!' : 'Try Again...', isCorrect ? '#dcfce7' : '#fee2e2');
            if (window.SimulationTracking) {
                window.SimulationTracking.trackQuestionAttempt('gravity-q1', 'option-A', isCorrect, 1);
            }
        }

        function saveProgress() {
            showStatus('Progress Saved to Portal');
            // Portal handles progress via sim messages or direct fetch if we implemented resume API
            console.log('Sim state saved');
        }

        function finishSim() {
            showStatus('Simulation Complete!', '#fef9c3');
            if (window.SimulationTracking) {
                window.SimulationTracking.trackSimulationComplete({ finalScore: 95 });
            }
        }
    </script>
    <script src="/tracking.js"></script>
</body>
</html>`;
      
      fs.writeFileSync(path.join(extractPath, "index.html"), htmlContent);
      res.json({ success: true, simId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve static simulations
  app.use("/simulations", express.static(simDir));

  // Tracking API
  const logsPath = path.join(uploadDir, "tracking_logs.jsonl");
  app.post("/api/track", (req, res) => {
    const event = req.body;
    fs.appendFileSync(logsPath, JSON.stringify(event) + "\n");
    res.json({ success: true });
  });

  app.get("/api/stats", (req, res) => {
    try {
      if (!fs.existsSync(logsPath)) return res.json({ totalEvents: 0, events: [], sessions: 0, typeDistribution: {} });
      
      const content = fs.readFileSync(logsPath, "utf8");
      const events = content.trim().split("\n").map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      // Simple aggregation
      const stats = {
        totalEvents: events.length,
        events: events,
        sessions: Array.from(new Set(events.map((e: any) => e.sessionId))).length,
        typeDistribution: events.reduce((acc: any, e: any) => {
          acc[e.type] = (acc[e.type] || 0) + 1;
          return acc;
        }, {}),
      };

      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Get simulations list
  app.get("/api/simulations", (req, res) => {
    try {
      const sims = fs.readdirSync(simDir).map(simId => {
        const simPath = path.join(simDir, simId, "index.html");
        if (fs.existsSync(simPath)) {
          return { id: simId, title: simId.replace(/-/g, ' '), path: `/simulations/${simId}/index.html` };
        }
        return null;
      }).filter(Boolean);
      res.json(sims);
    } catch (e) {
      res.json([]);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
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
