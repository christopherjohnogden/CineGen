// Retired: all CineGen application services now run in the owner Cloudflare account.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__migration/')) {
      return Response.json({ok:false,error:{code:'SITE_RETIRED',message:'CineGen has moved to https://cinegen-kappa.vercel.app.'}},{status:410,headers:{'cache-control':'no-store'}});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Gone',{status:410});
    return Response.redirect('https://cinegen-kappa.vercel.app' + url.pathname + url.search, 308);
  }
};
