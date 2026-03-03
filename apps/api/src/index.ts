import Fastify from "fastify";
import { registerRunRoutes } from "./routes/runs";
import { getDb } from "./db";

export function buildApp() {
  const app = Fastify({ logger: true });

  // Ensure database is initialised on startup
  getDb();

  registerRunRoutes(app);

  return app;
}

/* istanbul ignore next */
if (require.main === module) {
  const app = buildApp();
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";

  app.listen({ port, host }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}
