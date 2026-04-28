import fs from 'fs';
import path from 'path';

let content = fs.readFileSync('api/index.ts', 'utf8');

// Replace sync getDb/saveDb definitions
content = content.replace(/function getDb\(\) \{[\s\S]*?\}\n\nfunction saveDb.*?\}\n/m, 
`import { getSimulations, getSimulation, saveSimulation, deleteSimulationDb, getEvents, saveEvent } from "./db";\n`);

// Clean up stale builds
content = content.replace(/try \{\n    const DB_FILE = path\.join[\s\S]*?catch \(e\) \{\n    console\.error\("Failed to clean up stale builds:", e\);\n\}/m, 
`// Cleanup stale builds on startup
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
})();`);

// Remove old declarations
content = content.replace(/const DB_FILE = path\.join\(process\.cwd\(\), "uploads", "simdb\.json"\);\n/, '');
content = content.replace(/if \(\!fs\.existsSync\(DB_FILE\)\) \{\n  fs\.writeFileSync\(DB_FILE, JSON\.stringify\(\{ simulations: \[\] \}\), "utf8"\);\n\}\n/, '');

// Fix getSimulationsByRecent
content = content.replace(/function getSimulationsByRecent\(simulations: any\[\]\) \{[\s\S]*?\}\n/, '');

// Fix getSimulations
content = `
${content}
`;
fs.writeFileSync('rewrite-api.js', content);
