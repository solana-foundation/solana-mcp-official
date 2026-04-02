import { z } from "zod";

const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_SENTRY_ENABLED = false;
const DEFAULT_SENTRY_ENVIRONMENT = "development";
const DEFAULT_SENTRY_TRACES_SAMPLE_RATE = 0;

function warnOnInvalidConfig(field: string, input: unknown, fallback: unknown): void {
  if (input !== undefined) {
    console.warn(
      JSON.stringify({
        event: "config.fallback_applied",
        field,
        input: String(input),
        fallback: String(fallback),
      }),
    );
  }
}

export const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

const sentryEnabledSchema = z.preprocess(value => {
  if (typeof value !== "string") {
    return value;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return value;
}, z.boolean());

const nonEmptyStringSchema = z.string().trim().min(1);
const sentryTracesSampleRateSchema = z.coerce.number().min(0).max(1);

export type SentryRuntimeConfig = {
  enabled: boolean;
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
};

export type SolanaRpcRuntimeConfig = {
  mainnetBetaUrl: string | undefined;
  devnetUrl: string | undefined;
  testnetUrl: string | undefined;
  simd296Url: string | undefined;
};

export type SquadsRuntimeConfig = {
  lambdaUrl: string | undefined;
};

export function resolveLogLevel(value: string | undefined): LogLevel {
  const result = logLevelSchema.safeParse(value);
  if (result.success) return result.data;
  if (value !== undefined) {
    warnOnInvalidConfig("LOG_LEVEL", value, DEFAULT_LOG_LEVEL);
  }
  return DEFAULT_LOG_LEVEL;
}

// FIXME(@rogaldh, @pashpashkin): accept field name and call warnOnInvalidConfig on whitespace-only values.
// Left as-is for easier migration; will be fixed at the end of the inspect_entity port.
function resolveOptionalNonEmptyString(value: string | undefined): string | undefined {
  const result = nonEmptyStringSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function resolveSentryEnabled(value: string | undefined): boolean {
  const result = sentryEnabledSchema.safeParse(value);
  if (result.success) return result.data;
  if (value !== undefined) {
    warnOnInvalidConfig("SENTRY_ENABLED", value, DEFAULT_SENTRY_ENABLED);
  }
  return DEFAULT_SENTRY_ENABLED;
}

export function resolveSentryDsn(value: string | undefined): string | undefined {
  return resolveOptionalNonEmptyString(value);
}

export function resolveSentryEnvironment(value: string | undefined): string {
  const result = nonEmptyStringSchema.safeParse(value);
  if (result.success) return result.data;
  if (value !== undefined) {
    warnOnInvalidConfig("SENTRY_ENVIRONMENT", value, DEFAULT_SENTRY_ENVIRONMENT);
  }
  return DEFAULT_SENTRY_ENVIRONMENT;
}

export function resolveSentryRelease(value: string | undefined): string | undefined {
  return resolveOptionalNonEmptyString(value);
}

// safeParse needed: z.coerce transforms input before .catch sees it,
// so ctx.input would be NaN instead of the original string.
export function resolveSentryTracesSampleRate(value: string | undefined): number {
  const result = sentryTracesSampleRateSchema.safeParse(value);
  if (result.success) return result.data;
  if (value !== undefined) {
    warnOnInvalidConfig("SENTRY_TRACES_SAMPLE_RATE", value, DEFAULT_SENTRY_TRACES_SAMPLE_RATE);
  }
  return DEFAULT_SENTRY_TRACES_SAMPLE_RATE;
}

export const serviceConfig = {
  logLevel: resolveLogLevel(process.env.LOG_LEVEL),
  solanaRpc: {
    mainnetBetaUrl: resolveOptionalNonEmptyString(process.env.SOLANA_RPC_URL_MAINNET_BETA),
    devnetUrl: resolveOptionalNonEmptyString(process.env.SOLANA_RPC_URL_DEVNET),
    testnetUrl: resolveOptionalNonEmptyString(process.env.SOLANA_RPC_URL_TESTNET),
    simd296Url: resolveOptionalNonEmptyString(process.env.SOLANA_RPC_URL_SIMD296),
  } satisfies SolanaRpcRuntimeConfig,
  squads: {
    lambdaUrl: resolveOptionalNonEmptyString(process.env.SOLANA_SQUADS_LAMBDA_URL),
  } satisfies SquadsRuntimeConfig,
  sentry: {
    enabled: resolveSentryEnabled(process.env.SENTRY_ENABLED),
    dsn: resolveSentryDsn(process.env.SENTRY_DSN),
    environment: resolveSentryEnvironment(process.env.SENTRY_ENVIRONMENT),
    release: resolveSentryRelease(process.env.SENTRY_RELEASE),
    tracesSampleRate: resolveSentryTracesSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
  } satisfies SentryRuntimeConfig,
};
