# Edge Deployment Guide

Multi-region edge deployment configuration for JohnTran.js with geo-routing.

## Architecture Overview

                    +-----------------+
                    |  Cloudflare     |
                    |  Workers        |
                    |  (Geo-Router)   |
                    +--------+--------+
                             |
              +--------------+--------------+
              |              |              |
       +------v------+ +-----v-----+ +-----v-----+
       |   VN Region | | SG Region | | HK Region |
       |  (Primary)  | |(Secondary)| |(Tertiary) |
       |  2 replicas | | 1 replica | | 1 replica |
       +-------------+ +-----------+ +-----------+

## Regions

| Region | Location | Replicas | Purpose |
|--------|----------|----------|---------|
| **VN** | Ho Chi Minh City | 2 | Primary - Vietnam traffic |
| **SG** | Singapore | 1 | Secondary - Southeast Asia |
| **HK** | Hong Kong | 1 | Tertiary - Rest of world |

## Quick Start

### 1. Docker Compose (Local/VM)



### 2. Koyeb



### 3. Render



### 4. Cloudflare Workers (Geo-Routing)


# Health Check Endpoint

 The application must implement a / health endpoint that returns region information:
  
  ``jvascript\||`||`||`.get("/health", (req, res) => { 
    res.json({
      status: \"healthy\",
      region: process.env.REGION || \"unknown\",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.nmp_package_version || \"1.0.0\"
    });
  });
  ```

  ## Expected Response

   ``json\||`||`||`
{
    \"status\": \"healthy\",
    \"region\": \"vn\",
    \"timestamp\": \"2024-01-15T10:30:00.000Z\",
    \"uptime\": 3600.5,
    \"memory\": {
      \"rss\": 52428800,
      \"heapTtotal\": 31457280,
      \"heapUsed\": 20971520
    },
    \"version\": \"1.0.0\"
}
  ````
