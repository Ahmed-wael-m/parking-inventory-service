const express = require('express');
const { serviceAuth, userAuth, admin } = require('../middleware/auth');
const { controller: out } = require('../controllers/inventory');
const { ApiError } = require('../middleware/errors');
function routes(s, c) {
  const r = express.Router(), internal = serviceAuth(c), location = serviceAuth(c,true), user = userAuth(c);
  r.use((req,res,next)=>{
    if (['POST','PATCH'].includes(req.method) && !req.is('application/json')) return next(new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','Use application/json.'));
    next();
  });
  // Existing catalogue remains exactly compatible, including inactive and booked spaces.
  r.get('/spots', internal, out(req=>s.search(req.query,true),{catalogue:true}));
  r.get('/internal/availability', internal, out(req=>s.availability(req.query)));
  r.get('/internal/capacity', internal, out(req => {
    const pricing = Object.keys(req.query).some(
      key => key !== 'at'
    );

    return pricing
      ? s.pricingCapacity(req.query)
      : s.capacity(req.query);
}));
  r.get('/internal/spots/:id', location, out(req=>s.spot(req.params.id)));
  r.get('/internal/zones/:id', location, out(req=>s.zone(req.params.id)));
  r.post('/holds', internal, out(req=>s.hold(req.body)));
  r.get('/holds/:spot/:hold', internal, out(req=>s.getHold(req.params.spot,req.params.hold)));
  for(const action of ['confirm','release','extend']) r.post(`/holds/:spot/:hold/${action}`, internal, out(req=>s.transition(req.params.spot,req.params.hold,action,req.body)));
  r.use(user);
  r.get('/zones', out(()=>s.zones()));
  r.get('/zones/:id', out(req=>s.zone(req.params.id)));
  r.post('/zones', admin, out(req=>s.createZone(req.body),{status:201}));
  r.patch('/zones/:id', admin, out(req=>s.updateZone(req.params.id,req.body)));
  r.delete('/zones/:id', admin, out(req=>s.deleteZone(req.params.id)));
  r.get('/search', out(req=>s.search(req.query)));
  r.get('/spots/:id', out(req=>s.spot(req.params.id)));
  r.post('/spots', admin, out(req=>s.createSpot(req.body),{status:201}));
  r.patch('/spots/:id', admin, out(req=>s.updateSpot(req.params.id,req.body)));
  r.delete('/spots/:id', admin, out(req=>s.deleteSpot(req.params.id)));
  r.get('/capacity', out(req=>s.capacity(req.query)));
  r.get('/availability', out(req=>s.availability(req.query)));
  r.get('/alternatives', out(req=>s.alternatives(req.query)));
  return r;
}
module.exports={routes};
