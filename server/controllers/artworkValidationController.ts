import express, { type Request, type Response, type Router } from 'express';
import {
  getValidationDashboardSnapshot,
  triggerScheduledValidation,
  verifyScheduledValidationAuth,
  type ManualValidationDependencies,
} from '../manualUrlValidator.ts';

export interface ScheduledValidationControllerOptions {
  expectedSecret?: string;
  deps?: ManualValidationDependencies;
}

/**
 * Handler for POST /api/admin/validation/scheduled.
 * Verifies the X-Validation-Cron-Secret header (or Bearer fallback) against
 * process.env.VALIDATION_CRON_SECRET using constant-time comparison, rejects
 * unauthorized requests with HTTP 401, and triggers the manual artwork validation job.
 */
export function createScheduledValidationHandler(
  options?: ScheduledValidationControllerOptions
) {
  return async function scheduledValidationHandler(req: Request, res: Response) {
    const expectedSecret =
      options?.expectedSecret !== undefined
        ? options.expectedSecret
        : process.env.VALIDATION_CRON_SECRET;

    const authCheck = verifyScheduledValidationAuth(
      req.headers as Record<string, string | string[] | undefined>,
      expectedSecret,
      { requireSecret: true }
    );

    if (!authCheck.authorized) {
      const errorMessage =
        authCheck.reason === 'secret_not_configured'
          ? 'Scheduler secret is not configured on backend server'
          : 'Invalid or missing scheduler secret';
      res.status(401).json({
        ok: false,
        error: errorMessage,
      });
      return;
    }

    if (typeof req.setTimeout === 'function') {
      req.setTimeout(240_000);
    }
    if (typeof res.setTimeout === 'function') {
      res.setTimeout(240_000);
    }

    try {
      const result = await triggerScheduledValidation(options?.deps);
      const snapshot = getValidationDashboardSnapshot(undefined, options?.deps);
      res.status(200).json({
        ok: true,
        skippedOverlap: Boolean(result.skippedOverlap),
        checkedAt: new Date().toISOString(),
        summary: result.summary,
        cycle: {
          cycleId: result.cycle.cycleId,
          triggerSource: result.cycle.triggerSource,
          status: result.cycle.status,
          startedAt: result.cycle.startedAt,
          completedAt: result.cycle.completedAt,
          totalKeys: result.cycle.totalKeys,
          completedKeysCount: result.cycle.completedKeysCount,
          pendingKeysCount: result.cycle.pendingKeys.length,
        },
        scheduler: snapshot.scheduler,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scheduled validation failed';
      res.status(500).json({
        ok: false,
        error: message,
      });
    }
  };
}

export const scheduledValidationHandler = createScheduledValidationHandler();

/**
 * Express Router defining POST /api/admin/validation/scheduled.
 * Must be mounted in server.ts before any /api catch-all 404 or SPA fallback middleware.
 */
export function createArtworkValidationRouter(
  options?: ScheduledValidationControllerOptions
): Router {
  const router = express.Router();
  const handler = createScheduledValidationHandler(options);

  router.post(
    ['/api/admin/validation/scheduled', '/api/admin/validation/scheduled/'],
    handler
  );

  return router;
}

export const artworkValidationRouter = createArtworkValidationRouter();
