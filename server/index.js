import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3001;

// Resolve ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: '10mb' }));

// Paths
const PROJECT_ROOT = path.join(__dirname, '..');
const MAP_NODES_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'map_nodes.json');
const PIPELINE_OUTPUT_DIR = path.join(PROJECT_ROOT, 'pipeline_output');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const PIPELINE_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'map_pipeline.py');

// Ensure pipeline output directory exists
if (!fs.existsSync(PIPELINE_OUTPUT_DIR)) {
  fs.mkdirSync(PIPELINE_OUTPUT_DIR, { recursive: true });
}

// 1. Static file hosting for generated maps
app.use('/pipeline_output', express.static(PIPELINE_OUTPUT_DIR));

// 2. GET API: Load map layouts configuration
app.get('/api/maps', (req, res) => {
  try {
    if (!fs.existsSync(MAP_NODES_JSON)) {
      return res.status(404).json({ error: 'Config file not found' });
    }
    const rawData = fs.readFileSync(MAP_NODES_JSON, 'utf-8');
    const data = JSON.parse(rawData);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read layouts config', details: err.message });
  }
});

// 3. PUT API: Save updated layouts configuration
app.put('/api/maps', (req, res) => {
  try {
    const payload = req.body;

    // Basic structural validation
    if (!payload || !payload.maps) {
      return res.status(400).json({ error: 'Invalid payload structure' });
    }

    fs.writeFileSync(MAP_NODES_JSON, JSON.stringify(payload, null, 2), 'utf-8');
    res.json({ success: true, message: 'Layout config successfully written to disk' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write layouts config', details: err.message });
  }
});

// 4. POST API: Run map pipeline and stream output progress logs
app.post('/api/generate', (req, res) => {
  const styleIdx = parseInt(req.body.style_idx, 10) || 0;
  const noGenerate = !!req.body.no_generate;

  // Set headers for streaming response
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`[*] 后端已启动 map_pipeline.py, 选用风格模板: ${styleIdx} (no_generate=${noGenerate})\n`);

  // Find system Python executable path
  const pythonPath = process.platform === 'win32' ? 'python' : 'python3';

  const args = [PIPELINE_SCRIPT, '--style-idx', String(styleIdx)];
  if (noGenerate) {
    args.push('--no-generate');
  }

  const child = spawn(pythonPath, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env } // Pass environment variables for proxies
  });

  child.stdout.on('data', (data) => {
    res.write(data);
  });

  child.stderr.on('data', (data) => {
    res.write(`[Stderr] ${data}`);
  });

  child.on('close', (code) => {
    res.write(`\n[+] 进程执行完毕，退出代码: ${code}\n`);
    res.end();
  });

  child.on('error', (err) => {
    res.write(`[Error] 无法启动生图进程: ${err.message}\n`);
    res.end();
  });
});

// 5. Static file hosting for React production build (dist/)
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // Catch-all route to serve Index.html for single page routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// Start Server
app.listen(PORT, () => {
  console.log(`[Express] Backend server running on http://localhost:${PORT}`);
  console.log(`[Express] Static routes active for /pipeline_output`);
});
