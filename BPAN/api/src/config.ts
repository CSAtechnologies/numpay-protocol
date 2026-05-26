import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  rpcUrl: process.env.RPC_URL || "",
  contractAddress: process.env.CONTRACT_ADDRESS || "",
  corsOrigin: process.env.CORS_ORIGIN || "",
};

export function validateConfig(): void {
  if (!config.rpcUrl) {
    throw new Error("RPC_URL environment variable is required");
  }
  if (!config.contractAddress) {
    throw new Error("CONTRACT_ADDRESS environment variable is required");
  }
  if (!config.corsOrigin) {
    throw new Error("CORS_ORIGIN environment variable is required");
  }
}
