import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import cors from "cors";
import type { Server } from "node:http";
import type { Request, Response } from "express";

export async function proxyHandler(req: Request, res: Response) {
  const { url } = req.query;
  console.log(`[Proxy] Requesting: ${url}`);

  if (!url || typeof url !== 'string') {
    return res.status(400).send("URL is required");
  }

  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    response.data.pipe(res);

    response.data.on('error', (err: any) => {
      console.error('[Proxy] Stream error:', err);
      res.end();
    });
  } catch (error: any) {
    console.error("[Proxy] Error fetching resource:", error.message);
    res.status(500).send(`Failed to fetch resource: ${error.message}`);
  }
}

export function createApp() {
  const app = express();

  app.use(cors());

  app.get("/api/proxy", proxyHandler);

  return app;
}

export async function startServer() {
  const app = createApp();
  const PORT = 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  return app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

let server: Server | undefined;
if (process.env.NODE_ENV !== "test") {
  startServer().then((instance) => {
    server = instance;
  });
}

export { server };
