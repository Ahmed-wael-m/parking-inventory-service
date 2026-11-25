const { bad } = require('../middleware/errors');
// Initial types are a proposed local allowlist; confirm with Allocation before integration.
const TYPES = ['standard', 'accessible', 'ev'];
function id(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(value)) throw bad(`${field} must be 1–40 letters, numbers, underscores or hyphens.`);
  return value;
}
function type(value) { if (!TYPES.includes(value)) throw bad('spot_type must be standard, accessible or ev.'); return value; }
function bool(value) { if (typeof value !== 'boolean') throw bad('active must be boolean.'); return value; }
function text(value, field, max, optional = false) {
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) throw bad(`Invalid ${field}.`);
  return value.trim();
}
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw bad('Unknown or invalid fields.');
}
function filters(query, catalogue = false) {
  fields(query, catalogue ? ['zone_id', 'spot_type'] : ['zone_id', 'spot_type', 'active', 'q', 'sort']);
  const f = {};
  if (query.zone_id !== undefined) f.zone_id = id(query.zone_id, 'zone_id');
  if (query.spot_type !== undefined) f.spot_type = catalogue ? id(query.spot_type, 'spot_type') : type(query.spot_type);
  if (query.active !== undefined) {
    if (!['true', 'false'].includes(query.active)) throw bad('active must be true or false.');
    f.active = query.active === 'true';
  }
  if (query.q !== undefined) f.q = text(query.q, 'q', 80).toLowerCase();
  if (query.sort !== undefined && !['asc', 'desc'].includes(query.sort)) throw bad('sort must be asc or desc.');
  f.sort = query.sort || 'asc'; return f;
}
module.exports = { TYPES, id, type, bool, text, fields, filters };
