// Protected test-only endpoint. Replace the administrator test key with verified
// staff-session authorisation before enabling actual membership updates.
module.exports=require('../server/sync-handler.cjs').makeHandler();
