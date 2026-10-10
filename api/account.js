module.exports=(req,res)=>req.query?.section==='staff'?require('../server/staff-resources.cjs').makeStaffHandler()(req,res):require('../server/account.cjs').makeAccountHandler()(req,res);
