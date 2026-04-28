import express, { type Request, type Response } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getSimulations, getSimulation, saveSimulation, deleteSimulation, getEvents, saveEvent } from "./db.ts";

const router = express.Router();

// Clean up stale building statuses on startup
(async () => {
    try {
        const sims = await getSimulations();
        for (const sim of sims) {
            if (sim.status === 'building') {
                sim.status = 'error';
                sim.errorLog = 'Build was interrupted (server restarted).';
                await saveSimulation(sim);
            }
        }
    } catch (e) {
        console.error("Failed to clean up stale builds:", e);
    }
})();

router.use((req, res, next) => {
  console.log(`[API-Router] Received request: ${req.method} ${req.url}`);
  next();
});
router.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, true),
});

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "simulations");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

router.get("/health", (req, res) => res.json({ status: "ok" }));

router.get("/simulations", async (req: Request, res: Response) => {
  const sims = await getSimulations();
  // Deduplicate and get most recent
  const uniqueSims: any = {};
  sims.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((s: any) => {
    if (!uniqueSims[s.id]) {
      uniqueSims[s.id] = s;
    }
  });

  res.json(Object.values(uniqueSims).map((s: any) => ({
    id: s.id,
    title: s.title || s.id.replace(/-/g, ' '),
    path: `/api/simRender/${s.id}/index.html`,
    status: s.status || 'ready'
  })));
});

router.post("/track", async (req: Request, res: Response) => {
  try {
    const event = req.body;
    const eventId = `event-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await saveEvent({
      id: eventId,
      ...event,
      serverTime: Date.now()
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error("Track Error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const events = await getEvents();
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
});

const startBuild = async (simId: string, buildDir: string) => {
  console.log(`[Build] Starting build for ${simId} at ${buildDir}`);
  
  const pkgPath = path.join(buildDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    console.log(`[Build] Executing build for ${simId} in ${buildDir}`);
    const logStream = fs.createWriteStream(path.join(buildDir, "build.log"));
    
    const child = spawn("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], { cwd: buildDir, shell: true });
    
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    
    child.on('close', (code: number) => {
        if (code !== 0) {
            logStream.end();
            return handleBuildError(new Error(`npm install failed with code ${code}`));
        }
        
        const buildChild = spawn("npm", ["run", "build"], { cwd: buildDir, shell: true });
        buildChild.stdout.pipe(logStream, { end: false });
        buildChild.stderr.pipe(logStream, { end: false });
        
        buildChild.on('close', (buildCode: number) => {
            logStream.end();
            if (buildCode !== 0) {
                return handleBuildError(new Error(`npm run build failed with code ${buildCode}`));
            }
            handleBuildSuccess();
        });
    });

    async function handleBuildError(err: Error) {
        console.error(`[Build] Error building ${simId}:`, err);
        const sim = await getSimulation(simId);
        if (sim) {
            sim.status = 'error';
            sim.errorLog = err.message + '\nCheck build.log for details.';
            await saveSimulation(sim);
        }
    }

    async function handleBuildSuccess() {
        const sim = await getSimulation(simId);
        console.log(`[Build] Finished for ${simId}`);
        let outDir = path.join(buildDir, "dist");
        if (!fs.existsSync(outDir)) {
          const buildDirAlt = path.join(buildDir, "build");
          if (fs.existsSync(buildDirAlt)) {
            outDir = buildDirAlt;
          } else {
            outDir = buildDir;
          }
        }
        
        const indexHtmlMatch = path.join(outDir, "index.html");
        if (fs.existsSync(indexHtmlMatch)) {
          let html = fs.readFileSync(indexHtmlMatch, "utf8");
          if (!html.includes("tracking.js")) {
            const trackingScript = `\n<script src="tracking.js"></script>`;
            html = html.replace("</body>", `${trackingScript}</body>`);
            fs.writeFileSync(indexHtmlMatch, html, "utf8");
          }
        }

        if (sim) { 
           sim.status = 'ready'; 
           sim.serveDir = outDir; 
           await saveSimulation(sim); 
        }
    }
  } else {
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
    const sim = await getSimulation(simId);
    if (sim) { 
       sim.status = 'ready'; 
       sim.serveDir = buildDir; 
       await saveSimulation(sim); 
    }
  }
};

router.post("/upload", upload.single("simulation"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const rawSimId = req.body.simId || `sim-${Date.now()}`;
    const simId = rawSimId.replace(/[^a-zA-Z0-9_-]/g, "-");
    
    const simDir = path.join(UPLOADS_DIR, simId);
    const repoDir = path.join(simDir, "repo");
    if (!fs.existsSync(repoDir)) fs.mkdirSync(repoDir, { recursive: true });

    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(repoDir, true);

    let buildDir = repoDir;
    const contents = fs.readdirSync(repoDir);
    if (contents.length === 1 && fs.statSync(path.join(repoDir, contents[0])).isDirectory()) {
      buildDir = path.join(repoDir, contents[0]);
    }

    let existing = await getSimulation(simId);
    if (existing) {
      existing.status = 'building';
      existing.updatedAt = Date.now();
      existing.buildDir = buildDir;
      existing.errorLog = undefined;
      await saveSimulation(existing);
    } else {
      await saveSimulation({
        id: simId,
        title: req.body.title || req.file.originalname.replace(".zip", ""),
        createdAt: Date.now(),
        status: 'building',
        buildDir: buildDir
      });
    }

    res.json({ success: true, simId, path: `/api/simRender/${simId}/index.html`, status: 'building' });
    setTimeout(() => startBuild(simId, buildDir), 100);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/create-sample", async (req: Request, res: Response) => {
  const simId = "sample-lab-" + Math.floor(Math.random() * 1000);
  const dir = path.join(UPLOADS_DIR, simId, "repo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), `<!DOCTYPE html><html><body><h1>Sample Sim</h1><script src="/tracking.js"></script></body></html>`, "utf8");
  
  await saveSimulation({ id: simId, title: "Sample Lab", createdAt: Date.now(), status: 'ready', serveDir: dir });
  res.json({ success: true, simId });
});

async function triggerRepoImport(simId: string, repoFullName: string, token?: string) {
  const simDir = path.join(UPLOADS_DIR, simId);
  if (fs.existsSync(simDir)) fs.rmSync(simDir, { recursive: true });
  fs.mkdirSync(simDir, { recursive: true });
  const repoDir = path.join(simDir, "repo");
  fs.mkdirSync(repoDir, { recursive: true });

  const headers: Record<string, string> = {
    'User-Agent': 'NodeJS',
    'Accept': 'application/vnd.github.v3+json'
  };
  if (token) headers['Authorization'] = `token ${token}`;

  let zipUrl = `https://api.github.com/repos/${repoFullName}/zipball/main`;
  let res1 = await fetch(zipUrl, { method: "GET", headers, redirect: 'manual' });
  
  if (res1.status === 404) {
      zipUrl = `https://api.github.com/repos/${repoFullName}/zipball/master`;
      res1 = await fetch(zipUrl, { method: "GET", headers, redirect: 'manual' });
  }

  if (![301, 302].includes(res1.status)) {
      const contentType = res1.headers.get("content-type");
      let message;
      if (contentType && contentType.includes("application/json")) {
          const json = await res1.json();
          message = json.message || JSON.stringify(json);
      } else {
          message = await res1.text();
      }
      throw new Error(`GitHub API Error (${res1.status}): ${message}`);
  }

  const location = res1.headers.get('location');
  if (!location) throw new Error("Could not get zipball location");
  
  const zipRes = await fetch(location);
  if (!zipRes.ok) {
      const contentType = zipRes.headers.get("content-type");
      let message;
      if (contentType && contentType.includes("application/json")) {
          const json = await zipRes.json();
          message = json.message || JSON.stringify(json);
      } else {
          message = await zipRes.text();
      }
      throw new Error(`GitHub Download Link Error (${zipRes.status}): ${message}`);
  }
  
  const zipPath = path.join(simDir, "temp.zip");
  const destStream = fs.createWriteStream(zipPath);
  
  if (!zipRes.body) throw new Error("No response body");
  // @ts-ignore
  for await (const chunk of zipRes.body) destStream.write(chunk);
  destStream.end();
  
  await new Promise<void>((resolve, reject) => {
      destStream.on('finish', resolve);
      destStream.on('error', reject);
  });
  
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(repoDir, true);
  
  let buildDir = repoDir;
  const contents = fs.readdirSync(repoDir);
  if (contents.length > 0 && fs.statSync(path.join(repoDir, contents[0])).isDirectory()) {
    buildDir = path.join(repoDir, contents[0]);
  }

  const sim = await getSimulation(simId);
  if (sim) { sim.buildDir = buildDir; await saveSimulation(sim); }
  
  startBuild(simId, buildDir);
}

router.post("/import-repo", async (req: Request, res: Response) => {
  const { repoFullName, token, simId: rawSimId } = req.body;
  const simId = rawSimId.replace(/[^a-zA-Z0-9_-]/g, "-");
  
  let existing = await getSimulation(simId);
  if (existing) {
    existing.status = 'building';
    existing.updatedAt = Date.now();
    existing.errorLog = undefined;
    existing.repoFullName = repoFullName; 
    await saveSimulation(existing);
  } else {
    await saveSimulation({
      id: simId,
      title: repoFullName.split('/')[1] || repoFullName,
      repoFullName: repoFullName, 
      createdAt: Date.now(),
      status: 'building'
    });
  }

  res.json({ success: true, simId });

  triggerRepoImport(simId, repoFullName, token).catch(async (err: any) => {
    console.error("Import Error:", err);
    let sim = await getSimulation(simId);
    if (sim) { sim.status = 'error'; sim.errorLog = err.message; await saveSimulation(sim); }
  });
});

router.get("/simRender/:simId/*", async (req: Request, res: Response) => {
    try {
        const simId = req.params.simId;
        let filePath = req.params[0] || "index.html";
        if (filePath.endsWith("/")) filePath += "index.html";
        
        const sim = await getSimulation(simId);
        if (!sim) return res.status(404).send("Simulation not found");

        if (sim.status === "building") {
           return res.send(`<html><head><meta http-equiv="refresh" content="5"></head><body><h2>Simulation is building...</h2><p>Please wait a moment. The page will auto refresh.</p></body></html>`);
        } else if (sim.status === "error") {
           return res.send(`<html><body><h2>Build Error</h2><pre>${sim.errorLog}</pre></body></html>`);
        }

        const serveDir = sim.serveDir || sim.buildDir;
        if (!serveDir) return res.status(500).send("Serve directory not configured");

        const fullPath = path.join(serveDir, filePath);
        
        // Anti path traversal
        if (!fullPath.startsWith(path.resolve(serveDir))) {
            return res.status(403).send("Forbidden");
        }

        // AUTO REBUILD MAGIC FOR RENDER / SERVERLESS ENVIRONMENTS
        if (!fs.existsSync(serveDir)) {
           // We are in an ephemeral environment and the files were deleted!
           if (sim.repoFullName && sim.status === 'ready') {
               console.log(`[Auto-Rebuild] Files missing for ${simId}, triggering repo import from ${sim.repoFullName}`);
               sim.status = 'building';
               await saveSimulation(sim);
               triggerRepoImport(simId, sim.repoFullName).catch(async (err) => {
                   let failedSim = await getSimulation(simId);
                   if (failedSim) { failedSim.status = 'error'; failedSim.errorLog = err.message; await saveSimulation(failedSim); }
               });
               return res.send(`<html><head><meta http-equiv="refresh" content="5"></head><body><h2>Simulation is re-building...</h2><p>The server restarted, so we are automatically recovering this simulation from git. Please wait.</p></body></html>`);
           }
        }

        if (!fs.existsSync(fullPath)) {
            const idxPath = path.join(serveDir, "index.html");
            if (fs.existsSync(idxPath)) {
                let html = fs.readFileSync(idxPath, "utf8");
                html = html.replace(/(src|href)="\//g, '$1="./');
                return res.send(html);
            }
            return res.status(404).send("File not found in simulation");
        }
        
        if (filePath.endsWith("index.html")) {
            let html = fs.readFileSync(fullPath, "utf8");
            html = html.replace(/(src|href)="\//g, '$1="./');
            return res.send(html);
        }

        res.sendFile(fullPath);
    } catch (e: any) {
        res.status(500).send("Render error: " + e.message);
    }
});

router.get("/trigger-build/:simId", async (req, res) => {
    const sim = await getSimulation(req.params.simId);
    if (!sim) return res.status(404).send("Sim not found");
    sim.status = 'building';
    await saveSimulation(sim);
    startBuild(sim.id, sim.buildDir);
    res.send("Build started");
});

router.post("/delete-simulation/:simId", async (req, res) => {
    const simId = decodeURIComponent(req.params.simId);
    const sim = await getSimulation(simId);
    
    if (!sim) {
        const simDir = path.join(UPLOADS_DIR, simId);
        if (fs.existsSync(simDir)) fs.rmSync(simDir, { recursive: true, force: true });
        return res.json({ success: true, deleted: 0, note: "Not found in DB but folder cleanup attempted" });
    }

    const simDir = path.join(UPLOADS_DIR, sim.id);
    if (fs.existsSync(simDir)) {
        try { fs.rmSync(simDir, { recursive: true, force: true }); } catch (err) { }
    }

    await deleteSimulation(simId);
    res.json({ success: true, deleted: 1 });
});

export default router;
