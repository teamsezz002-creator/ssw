import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import mime from "mime-types";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

const router = express.Router();

router.use((req, res, next) => {
  console.log(`[API-Router] Received request: ${req.method} ${req.url}`);
  next();
});
router.use(express.json());

// In-memory multer is fine for downloading the zip
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // accept zip
    cb(null, true);
  },
});

const DB_FILE = path.join(process.cwd(), "uploads", "simdb.json");
const UPLOADS_DIR = path.join(process.cwd(), "uploads", "simulations");

// Ensure dirs exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ simulations: [] }), "utf8");
}

function getDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return { simulations: [] };
  }
}

function saveDb(data: any) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

const getSimulations = async (req: Request, res: Response) => {
  const db = getDb();
  res.json(db.simulations.map((s: any) => ({
    id: s.id,
    title: s.id.replace(/-/g, ' '),
    path: `/api/simRender/${s.id}/index.html`,
    status: s.status || 'ready'
  })));
};

const handleTrack = async (req: Request, res: Response) => {
  try {
    const event = req.body;
    const db = getDb();
    if (!db.events) db.events = [];
    const eventId = `event-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    db.events.push({
      id: eventId,
      ...event,
      serverTime: Date.now()
    });
    saveDb(db);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Track Error:", error);
    res.status(500).json({ error: error.message });
  }
};

const getStats = async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const events = db.events || [];
    res.json({
        totalEvents: events.length,
        events: events,
        sessions: Array.from(new Set(events.map((e: any) => e.sessionId))).length,
        typeDistribution: events.reduce((acc: any, e: any) => {
          acc[e.type] = (acc[e.type] || 0) + 1;
          return acc;
        }, {}),
    });
  } catch(e: any) {
    res.status(500).json({ error: e.message });
  }
};

const startBuild = (simId: string, buildDir: string) => {
  console.log(`[Build] Starting build for ${simId} at ${buildDir}`);
  
  const pkgPath = path.join(buildDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    // Needs build
    console.log(`[Build] Executing build for ${simId} in ${buildDir}`);
    exec("npm install && npm run build", { cwd: buildDir }, (err, stdout, stderr) => {
      fs.writeFileSync(path.join(buildDir, "build.log"), `Errors: ${err}\nStdout: ${stdout}\nStderr: ${stderr}`);
      const db = getDb();
      const sim = db.simulations.find((s: any) => s.id === simId);
      if (err) {
        console.error(`[Build] Error building ${simId}:`, err);
        if (sim) { sim.status = 'error'; sim.errorLog = stderr; saveDb(db); }
      } else {
        console.log(`[Build] Finished for ${simId}`);
        // Check if dist/ or build/ created
        let outDir = path.join(buildDir, "dist");
        if (!fs.existsSync(outDir)) {
          const buildDirAlt = path.join(buildDir, "build");
          if (fs.existsSync(buildDirAlt)) {
            outDir = buildDirAlt;
          } else {
            // If neither dist/ nor build/ exist, assume the root of buildDir was the output (e.g., static)
            outDir = buildDir;
          }
        }
        
        // Inject tracking script
        const indexHtmlMatch = path.join(outDir, "index.html");
        if (fs.existsSync(indexHtmlMatch)) {
          let html = fs.readFileSync(indexHtmlMatch, "utf8");
          if (!html.includes("tracking.js")) {
            const trackingScript = `\n<script src="tracking.js"></script>`;
            html = html.replace("</body>", `${trackingScript}</body>`);
            fs.writeFileSync(indexHtmlMatch, html, "utf8");
          }
        }

        if (sim) { sim.status = 'ready'; sim.serveDir = outDir; saveDb(db); }
      }
    });
  } else {
    // Static HTML
    console.log(`[Build] No package.json found for ${simId}, treating as static HTML.`);
    const indexHtmlMatch = path.join(buildDir, "index.html");
    if (fs.existsSync(indexHtmlMatch)) {
      let html = fs.readFileSync(indexHtmlMatch, "utf8");
      if (!html.includes("tracking.js")) {
        const trackingScript = `\n<script src="tracking.js"></script>`;
        html = html.replace("</body>", `${trackingScript}</body>`);
        fs.writeFileSync(indexHtmlMatch, html, "utf8");
      }
    }
    const db = getDb();
    const sim = db.simulations.find((s: any) => s.id === simId);
    if (sim) { sim.status = 'ready'; sim.serveDir = buildDir; saveDb(db); }
  }
};

const handleUpload = async (req: Request, res: Response) => {
  console.log("[Upload] Received upload request", { body: req.body });
  try {
    if (!req.file) {
      console.log("[Upload] Error: No file in request");
      return res.status(400).json({ error: "No file uploaded" });
    }
    console.log("[Upload] File received:", req.file.originalname, req.file.size);

    const rawSimId = req.body.simId || `sim-${Date.now()}`;
    const simId = rawSimId.replace(/[^a-zA-Z0-9_-]/g, "-");
    
    const simDir = path.join(UPLOADS_DIR, simId);
    const repoDir = path.join(simDir, "repo");
    if (!fs.existsSync(repoDir)) {
      fs.mkdirSync(repoDir, { recursive: true });
    }

    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(repoDir, true);

    // GitHub zipball extracts to a single top-level folder 'owner-repo-commitHash'
    let buildDir = repoDir;
    const contents = fs.readdirSync(repoDir);
    if (contents.length === 1 && fs.statSync(path.join(repoDir, contents[0])).isDirectory()) {
      buildDir = path.join(repoDir, contents[0]);
    }

    const db = getDb();
    const existing = db.simulations.find((s: any) => s.id === simId);
    if (existing) {
      existing.status = 'building';
      existing.updatedAt = Date.now();
      existing.buildDir = buildDir; // important to update buildDir
    } else {
      db.simulations.push({
        id: simId,
        createdAt: Date.now(),
        status: 'building',
        buildDir: buildDir
      });
    }
    saveDb(db);

    res.json({ success: true, simId, path: `/api/simRender/${simId}/index.html`, status: 'building' });

    setTimeout(() => startBuild(simId, buildDir), 100);

  } catch (err: any) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: err.message });
  }
};

const handleCreateSample = async (req: Request, res: Response) => {
  const simId = "sample-lab-" + Math.floor(Math.random() * 1000);
  const db = getDb();
  const dir = path.join(UPLOADS_DIR, simId, "repo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), `<!DOCTYPE html><html><body><h1>Sample Sim</h1><script src="/tracking.js"></script></body></html>`, "utf8");
  
  db.simulations.push({ id: simId, createdAt: Date.now(), status: 'ready', serveDir: dir });
  saveDb(db);

  res.json({ success: true, simId });
};

const handleSimRender = async (req: Request, res: Response) => {
    try {
        const simId = req.params.simId;
        // param path might be empty if it's just /api/simRender/foo/
        // Actually, the route is /simRender/:simId/* so req.params[0] is the rest.
        let filePath = req.params[0] || "index.html";
        if (filePath.endsWith("/")) filePath += "index.html";
        
        const db = getDb();
        const sim = db.simulations.find((s: any) => s.id === simId);
        if (!sim) return res.status(404).send("Simulation not found");

        if (sim.status === "building") {
           return res.send(`<html><body><h2>Simulation is building...</h2><p>Please wait a moment and refresh.</p></body></html>`);
        } else if (sim.status === "error") {
           return res.send(`<html><body><h2>Build Error</h2><pre>${sim.errorLog}</pre></body></html>`);
        }

        const serveDir = sim.serveDir || sim.buildDir;
        if (!serveDir) return res.status(500).send("Serve directory not configured");

        const fullPath = path.join(serveDir, filePath);
        console.log(`[Render] filePath: ${filePath}, serveDir: ${serveDir}, fullPath: ${fullPath}`);
        
        // Prevent path traversal
        if (!fullPath.startsWith(path.resolve(serveDir))) {
            return res.status(403).send("Forbidden");
        }

        if (!fs.existsSync(fullPath)) {
            // fallback to index.html for SPA
            const idxPath = path.join(serveDir, "index.html");
            if (fs.existsSync(idxPath)) {
                let html = fs.readFileSync(idxPath, "utf8");
                html = html.replace(/(src|href)="\//g, '$1="./');
                return res.send(html);
            }
            return res.status(404).send("File not found in simulation");
        }
        
        // If it is index.html, transform it
        if (filePath.endsWith("index.html")) {
            let html = fs.readFileSync(fullPath, "utf8");
            html = html.replace(/(src|href)="\//g, '$1="./');
            return res.send(html);
        }

        res.sendFile(fullPath);
    } catch (e: any) {
        res.status(500).send("Render error: " + e.message);
    }
};

const handleImportRepo = async (req: Request, res: Response) => {
  const { repoFullName, token, simId: rawSimId } = req.body;
  const simId = rawSimId.replace(/[^a-zA-Z0-9_-]/g, "-");
  
  // Create dir
  const simDir = path.join(UPLOADS_DIR, simId);
  if (fs.existsSync(simDir)) fs.rmSync(simDir, { recursive: true });
  fs.mkdirSync(simDir, { recursive: true });
  const repoDir = path.join(simDir, "repo");
  fs.mkdirSync(repoDir, { recursive: true });

  const db = getDb();
  db.simulations.push({
    id: simId,
    createdAt: Date.now(),
    status: 'building'
  });
  saveDb(db);

  res.json({ success: true, simId });

  // Do the work in background
  (async () => {
    try {
      // 1. Fetch zipball
      let zipUrl = `https://api.github.com/repos/${repoFullName}/zipball/main`;
      
      let res1 = await fetch(zipUrl, {
        method: "GET",
        headers: { 'Authorization': `token ${token}` },
        redirect: 'manual'
      });
      
      if (res1.status === 404) {
         zipUrl = `https://api.github.com/repos/${repoFullName}/zipball/master`;
         res1 = await fetch(zipUrl, {
            method: "GET",
            headers: { 'Authorization': `token ${token}` },
            redirect: 'manual'
          });
      }

      const location = res1.headers.get('location');
      if (!location) throw new Error("Could not get zipball location");
      
      const zipRes = await fetch(location);
      if (!zipRes.ok) throw new Error("Could not download zipball");
      
      const buffer = Buffer.from(await zipRes.arrayBuffer());
      
      // Save zip to file
      const zipPath = path.join(simDir, "temp.zip");
      fs.writeFileSync(zipPath, buffer);
      
      // Extraction
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(repoDir, true);
      
      // Find build directory
      let buildDir = repoDir;
      const contents = fs.readdirSync(repoDir);
      if (contents.length > 0 && fs.statSync(path.join(repoDir, contents[0])).isDirectory()) {
        buildDir = path.join(repoDir, contents[0]);
      }

      const db = getDb();
      const sim = db.simulations.find((s: any) => s.id === simId);
      if (sim) { sim.buildDir = buildDir; saveDb(db); }
      
      console.log(`[Import] Found sim, calling startBuild. simId: ${simId}, buildDir: ${buildDir}`);
      startBuild(simId, buildDir);
      
    } catch (err: any) {
      console.error("Import Error:", err);
      const db = getDb();
      const sim = db.simulations.find((s: any) => s.id === simId);
      if (sim) { sim.status = 'error'; sim.errorLog = err.message; saveDb(db); }
    }
  })();
};

// Route Registration
router.get("/health", (req, res) => res.json({ status: "ok" }));
router.get("/simulations", getSimulations);
router.post("/track", handleTrack);
router.get("/stats", getStats);
router.post("/upload", upload.single("simulation"), handleUpload);
router.post("/import-repo", handleImportRepo);
router.get("/trigger-build/:simId", (req, res) => {
    const db = getDb();
    const sim = db.simulations.find((s: any) => s.id === req.params.simId);
    if (!sim) return res.status(404).send("Sim not found");
    sim.status = 'building';
    saveDb(db);
    startBuild(sim.id, sim.buildDir);
    res.send("Build started");
});
router.post("/create-sample", handleCreateSample);
router.get("/simRender/:simId/*", handleSimRender);

export default router;



