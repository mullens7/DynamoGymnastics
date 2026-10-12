module.exports=(req,res)=>req.query?.kind==='events'?require('../server/public-events.cjs').makePublicEventsHandler()(req,res):require('../server/results.cjs').makeResultsHandler()(req,res);
