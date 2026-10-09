const WEBSITE_ADMINS=new Set(['freddie','kerri','admin','kayleigh','karen','anthony','tayah'].map(name=>name+'@dynamogymnastics.co.uk'));
const isWebsiteAdmin=email=>WEBSITE_ADMINS.has(String(email||'').trim().toLowerCase());
module.exports={isWebsiteAdmin};
