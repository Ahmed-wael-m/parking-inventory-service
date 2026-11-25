class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = message => new ApiError(400, 'VALIDATION_ERROR', message);
const missing = message => new ApiError(404, 'NOT_FOUND', message);
const conflict = message => new ApiError(409, 'CONFLICT', message);
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let e = err;
  if (err.type === 'entity.parse.failed') e = bad('Invalid JSON.');
  if (err.type === 'entity.too.large') e = new ApiError(413, 'BODY_TOO_LARGE', 'Request exceeds 16 KB.');
  if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') e = new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request encoding.');
  if (!(e instanceof ApiError)) {
    console.error(JSON.stringify({ event: 'unexpected_error', name: err.name }));
    e = new ApiError(500, 'INTERNAL_ERROR', 'Unexpected server error.');
  }
  res.status(e.status).json({ success: false, error: { code: e.code, message: e.message } });
}
module.exports = { ApiError, bad, missing, conflict, errorHandler };
