import type { Request, Response } from 'express';
import {
  getValidationDashboardSnapshot,
  triggerScheduledValidation,
  verifyScheduledValidationAuth,
  type ManualValidationDependencies,
} from '../../manualUrlValidator.ts';

export interface ScheduledValidationHandlerOptions {
  expectedSecret?: string;
  deps?: ManualValidationDependencies;
}

/**
 * Factory for the Cloud Run / GitHub Actions scheduled artwork validation endpoint.
 * Rejects missing server configuration or mismatched X-Validation-Cron-Secret / Bearer tokens
 * with HTTP 401 without logging or exposing the secret value.
 */
export function createScheduledValidationHandler(
  options?: ScheduledValidationHandlerOptions
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
