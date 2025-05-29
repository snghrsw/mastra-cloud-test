
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { LangfuseExporter } from "langfuse-vercel";

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  telemetry: {
    serviceName: "ai", // this must be set to "ai" so that the LangfuseExporter thinks it's an AI SDK trace
    enabled: true,
    export: {
      type: "custom",
      exporter: new LangfuseExporter({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASEURL,
      }),
    },
  },
  server: {
    middleware: [
      {
        handler: async (c, next) => {
        const isFromMastraCloud = c.req.header('x-mastra-cloud') === 'true';
        const isDevPlayground = c.req.header('x-mastra-dev-playground') === 'true'
        if(isFromMastraCloud || isDevPlayground) {
          await next();
        }

        const authHeader = c.req.header("Authorization");
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return new Response('Unauthorized', { status: 401 });
        }
        const token = authHeader.substring(7);
        const validApiKey = process.env.BEARER_KEY || 'your-secret-api-key';
        if (token !== validApiKey) {
        return new Response('Invalid token', { status: 401 });
        }
        await next();
        },
        path: "/api/*",
      },
    ]
  }
});
