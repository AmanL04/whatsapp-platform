import type { Request, Response, NextFunction } from 'express'
import type { AppRegistry } from '../apps/registry'
import type { App } from '../core/types'

// Extend Express Request to include the resolved app
declare global {
  namespace Express {
    interface Request {
      waApp?: App
    }
  }
}

export function createApiAuthMiddleware(registry: AppRegistry) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header. Expected: Bearer <api_key>' })
      return
    }

    const apiKey = authHeader.slice(7) // strip 'Bearer '
    const app = registry.getAppByApiKey(apiKey)

    if (!app || !app.active) {
      res.status(401).json({ error: 'Invalid or inactive API key' })
      return
    }

    req.waApp = app
    next()
  }
}
