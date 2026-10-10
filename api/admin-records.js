module.exports=(req,res)=>req.query?.kind==='party-slots'?require('../server/party-slots.cjs').makePartySlotsHandler()(req,res):require('../server/admin-records.cjs').makeRecordsHandler()(req,res);
