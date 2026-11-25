const jwt = require('jsonwebtoken');
const { timingSafeEqual, createHash } = require('node:crypto');
const { ApiError } = require('./errors');
const denied = () => new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid credentials.');
function bearer(req) { return /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '')?.[1]; }
function digest(s) { return createHash('sha256').update(s).digest(); }
function serviceAuth(c, locationOnly = false) {
  return (req, res, next) => {
    const token = bearer(req);
    const expected = locationOnly ? c.locationToken : c.token;
    if (!token || !expected || !timingSafeEqual(digest(token), digest(expected))) return next(denied());
    next();
  };
}
function userAuth(c) {
  return (req, res, next) => {
    try {
      const claims = jwt.verify(bearer(req) || '', c.secret, { algorithms: ['HS256'], issuer: c.issuer, audience: c.audience });
      if (typeof claims.sub !== 'string' || !claims.sub || !['user', 'admin'].includes(claims.role) || ![1, 2].includes(claims.priority) || !Number.isFinite(claims.exp)) throw Error();
      req.user = claims; next();
    } catch { next(denied()); }
  };
}
function admin(req, res, next) {
  if (req.user.role !== 'admin') return next(new ApiError(403, 'FORBIDDEN', 'Administrator role required.'));
  next();
}
module.exports = { serviceAuth, userAuth, admin };
