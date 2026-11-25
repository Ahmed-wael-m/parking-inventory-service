const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { inventory } = require('./src/services/inventory');
const { routes } = require('./src/routes/inventory');
const { ApiError, errorHandler } = require('./src/middleware/errors');
function createApp(repo, c) {
  const app = express();
  app.disable('x-powered-by');
  // Trust no forwarded client addresses until the team verifies the ALB topology.
  const instanceId = c.instanceId || 'inventory-test';
  app.use(helmet());
  app.use((req,res,next) => { res.set('X-Instance-ID', instanceId); next(); });
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => console.log(JSON.stringify({ instanceId, method: req.method, status: res.statusCode, route: req.route?.path || 'unmatched', ms: Date.now()-start })));
    next();
  });
  app.get('/health', (req,res) => res.json({ status: 'ok', service: 'inventory', instanceId, port: c.port || req.socket.localPort }));
  app.use(cors({ origin(origin, cb) { if (!origin || c.origins.includes(origin)) return cb(null, true); cb(new ApiError(403, 'ORIGIN_DENIED', 'Origin not allowed.')); }, methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Authorization','Content-Type'] }));
  app.use(rateLimit({ windowMs: 60000, limit: c.rateMax, standardHeaders: 'draft-7', legacyHeaders: false, handler(req,res,next) { next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.')); } }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/inventory', routes(inventory(repo,c), c));
  app.use((req,res,next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
