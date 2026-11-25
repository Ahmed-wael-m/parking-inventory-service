// Controllers turn service results into HTTP responses.
function controller(fn, { status = 200, catalogue = false } = {}) {
  return async (req, res) => {
    const data = await fn(req);
    res.status(status).json(catalogue ? { data } : { success: true, data });
  };
}
module.exports = { controller };
