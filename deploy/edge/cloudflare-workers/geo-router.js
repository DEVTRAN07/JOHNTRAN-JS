// Cloudflare Worker for Geo-Routing at Edge
// Deploy to Cloudflare Workers for global edge routing

// Region mapping: country code -> region
const REGION_MAP = {
  'VN': 'vn',
  'SG': 'sg',
  'MY': 'sg',
  'TH': 'sg',
  'ID': 'sg',
  'PH': 'sg',
  'MM': 'sg',
  'LA': 'sg',
  'KH': 'sg',
  'BN': 'sg',
  'TL': 'sg',
};

// Origin endpoints for each region
const ORIGINS = {
  vn: 'https://vn.johntran-js.example.com',
  sg: 'https://sg.johntran-js.example.com',
  hk: 'https://hk.johntran-js.example.com',
};

// Health check endpoints
const HEALTH_ENDPOINTS = {
  vn: 'https://vn.johntran-js.example.com/health',
  sg: 'https://sg.johntran-js.example.com/health',
  hk: 'https://hk.johntran-js.example.com/health',
};

// Cache for health status
const healthCache = new Map();
const HEALTH_CACHE_TTL = 30000; // 30 seconds

// Get region from country code
function getRegion(countryCode) {
  return REGION_MAP[countryCode] || 'hk';
}

// Check health of an origin
async function checkHealth(region) {
  const now = Date.now();
  const cached = healthCache.get(region);
  
  if (cached && now - cached.timestamp < HEALTH_CACHE_TTL) {
    return cached.healthy;
  }
  
  try {
    const response = await fetch(HEALTH_ENDPOINTS[region], {
      method: 'GET',
      cf: { cacheTtl: 0 },
      headers: { 'User-Agent': 'Cloudflare-Worker-HealthCheck/1.0' }
    });
    const healthy = response.ok;
    healthCache.set(region, { healthy, timestamp: now });
    return healthy;
  } catch {
    healthCache.set(region, { healthy: false, timestamp: now });
    return false;
  }
}

// Get healthy region with fallback
async function getHealthyRegion(preferredRegion) {
  // Try preferred region first
  if (await checkHealth(preferredRegion)) {
    return preferredRegion;
  }
  
  // Fallback order: VN -> SG -> HK
  const fallbackOrder = ['vn', 'sg', 'hk'];
  for (const region of fallbackOrder) {
    if (region !== preferredRegion && await checkHealth(region)) {
      console.log();
      return region;
    }
  }
  
  // All regions unhealthy, return preferred anyway
  return preferredRegion;
}

// Main fetch handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const countryCode = request.cf?.country || 'XX';
    const preferredRegion = getRegion(countryCode);
    const region = await getHealthyRegion(preferredRegion);
    const origin = ORIGINS[region];
    
    // Handle health check requests
    if (url.pathname === '/health' || url.pathname.startsWith('/health/')) {
      const healthUrl = new URL(url.pathname, origin);
      const healthResponse = await fetch(healthUrl.toString(), {
        method: request.method,
        headers: request.headers,
        cf: { cacheTtl: 0 }
      });
      
      // Add region info to response headers
      const responseHeaders = new Headers(healthResponse.headers);
      responseHeaders.set('X-Edge-Region', region);
      responseHeaders.set('X-Client-Country', countryCode);
      responseHeaders.set('X-Preferred-Region', preferredRegion);
      
      return new Response(healthResponse.body, {
        status: healthResponse.status,
        statusText: healthResponse.statusText,
        headers: responseHeaders
      });
    }
    
    // Forward request to selected origin
    const originUrl = new URL(url.pathname + url.search, origin);
    
    // Prepare headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');
    requestHeaders.set('X-Forwarded-Proto', 'https');
    requestHeaders.set('X-Edge-Region', region);
    requestHeaders.set('X-Client-Country', countryCode);
    requestHeaders.set('X-Preferred-Region', preferredRegion);
    requestHeaders.set('CF-IPCountry', countryCode);
    
    // Handle WebSocket upgrade
    if (requestHeaders.get('Upgrade') === 'websocket') {
      return fetch(originUrl.toString(), {
        method: request.method,
        headers: requestHeaders,
        body: request.body
      });
    }
    
    // Regular request
    const response = await fetch(originUrl.toString(), {
      method: request.method,
      headers: requestHeaders,
      body: request.body,
      redirect: 'follow',
      cf: {
        // Cache static assets at edge
        cacheTtl: url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/i) ? 31536000 : 0,
        cacheKey: originUrl.pathname + url.search,
        // Enable Argo Smart Routing if available
        apps: true
      }
    });
    
    // Add response headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-Edge-Region', region);
    responseHeaders.set('X-Client-Country', countryCode);
    responseHeaders.set('X-Preferred-Region', preferredRegion);
    responseHeaders.set('Server', 'Cloudflare-Worker/1.0');
    
    // CORS headers
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  }
};

// Scheduled health check (run every minute via Cron Trigger)
export async function scheduled(event, env, ctx) {
  console.log('Running scheduled health check for all regions');
  for (const region of Object.keys(ORIGINS)) {
    await checkHealth(region);
  }
}
