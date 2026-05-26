import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, validateConfig } from "./config";
import routes from "./routes";

validateConfig();

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  })
);

app.use("/api/v1", routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

function safeRpcHost(url: string): string {
  try { return new URL(url).hostname; } catch { return "[invalid]"; }
}

app.listen(config.port, () => {
  console.log(`BANP API running on port ${config.port}`);
  console.log(`Contract: ${config.contractAddress}`);
  console.log(`RPC host: ${safeRpcHost(config.rpcUrl)}`);
});

export default app;
