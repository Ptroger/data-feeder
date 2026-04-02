import { z } from "zod";

// --- TTL parsing ---

const TTL_REGEX = /^(\d+)(s|m|h|d)$/;
const TTL_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseTtl(ttl: string): number {
  const match = ttl.match(TTL_REGEX);
  if (!match) throw new Error(`Invalid TTL format: "${ttl}". Expected format: 30s, 5m, 1h, 24h, 7d`);
  return parseInt(match[1], 10) * TTL_MULTIPLIERS[match[2]];
}

const TtlSchema = z.string().regex(TTL_REGEX, "Invalid TTL format. Expected: 30s, 5m, 1h, 24h, 7d");

// --- Feed name ---

const FeedNameSchema = z.string().regex(
  /^[a-zA-Z][a-zA-Z0-9_]*$/,
  "Feed name must start with a letter and contain only alphanumeric characters and underscores"
);

// --- Auth schemas ---

const ApiKeyAuthSchema = z
  .object({
    type: z.literal("api_key"),
    param: z.string().optional(),
    header: z.string().optional(),
    key: z.string(),
  })
  .refine((data) => (data.param ? !data.header : data.header), {
    message: "api_key auth requires either 'param' or 'header', but not both",
  });

const BearerAuthSchema = z.object({
  type: z.literal("bearer"),
  token: z.string(),
});

const X402AuthSchema = z.object({
  type: z.literal("x402"),
  wallet_key: z.string(),
  network: z.enum(["base", "base-sepolia"]).default("base"),
  max_per_call: z.number().positive().default(0.01),
});

const NoneAuthSchema = z.object({
  type: z.literal("none"),
});

const AuthSchema = z.discriminatedUnion("type", [
  NoneAuthSchema,
  z.object({
    type: z.literal("api_key"),
    param: z.string().optional(),
    header: z.string().optional(),
    key: z.string(),
  }),
  BearerAuthSchema,
  X402AuthSchema,
]);

// Refine api_key auth after parsing
export type AuthConfig = z.infer<typeof AuthSchema>;

// --- Expose param schema ---

const ExposeParamSchema = z.object({
  type: z.enum(["string", "number", "boolean"]).default("string"),
  description: z.string().optional(),
  required: z.boolean().default(true),
});

// --- Schedule entry ---

const ScheduleEntrySchema = z
  .object({
    params: z.record(z.unknown()).default({}),
    every: TtlSchema.optional(),
    cron: z.string().optional(),
  })
  .refine((data) => (data.every ? !data.cron : data.cron), {
    message: "Schedule entry requires either 'every' or 'cron', but not both",
  });

// --- Expose schema ---

const ExposeToolSchema = z.object({
  type: z.literal("tool"),
  name: z.string(),
  description: z.string(),
  params: z.record(ExposeParamSchema).default({}),
});

const ExposeResourceSchema = z.object({
  type: z.literal("resource"),
  name: z.string(),
  description: z.string(),
});

const ExposeSchema = z.discriminatedUnion("type", [ExposeToolSchema, ExposeResourceSchema]);

// --- Source schema ---

const ResponseSchema = z.object({
  path: z.string(),
});

const SourceSchema = z.object({
  url: z.string().url("Source URL must be a valid URL"),
  method: z.enum(["GET", "POST"]).default("GET"),
  auth: AuthSchema.default({ type: "none" }),
  headers: z.record(z.string()).optional(),
  default_params: z.record(z.string()).optional(),
  params: z.record(z.string()).optional(),
  response: ResponseSchema.optional(),
});

// --- Cache schema ---

const CacheSchema = z.object({
  ttl: TtlSchema.default("5m"),
  key: z.string().optional(),
});

// --- Single feed schema ---

const FeedSchema = z.object({
  source: SourceSchema,
  cache: CacheSchema.default({}),
  schedule: z.array(ScheduleEntrySchema).optional(),
  expose: ExposeSchema,
  timeout: TtlSchema.optional(),
  retries: z.number().int().min(0).max(10).optional(),
});

export type FeedConfig = z.infer<typeof FeedSchema>;
export type ExposeConfig = z.infer<typeof ExposeSchema>;
export type ExposeParamConfig = z.infer<typeof ExposeParamSchema>;
export type ScheduleEntryConfig = z.infer<typeof ScheduleEntrySchema>;
export type SourceConfig = z.infer<typeof SourceSchema>;

// --- Server schema ---

const ServerSchema = z.object({
  name: z.string().default("data-feeder"),
  version: z.string().default("1.0.0"),
  transport: z.enum(["stdio", "http"]).default("stdio"),
  port: z.number().int().min(1).max(65535).default(3100),
});

// --- Defaults schema ---

const DefaultsSchema = z.object({
  cache: TtlSchema.default("5m"),
  timeout: TtlSchema.default("10s"),
  retries: z.number().int().min(0).max(10).default(3),
  retry_backoff: z.enum(["exponential", "linear"]).default("exponential"),
});

// --- Budget schema ---

const BudgetSchema = z.object({
  daily_max: z.number().positive().optional(),
  alert_threshold: z.number().min(0).max(1).default(0.8),
});

// --- Root config schema ---

export const DataFeederConfigSchema = z.object({
  server: ServerSchema.default({}),
  defaults: DefaultsSchema.default({}),
  budget: BudgetSchema.optional(),
  feeds: z.record(FeedNameSchema, FeedSchema).refine(
    (feeds) => Object.keys(feeds).length > 0,
    "At least one feed must be defined"
  ),
});

export type DataFeederConfig = z.infer<typeof DataFeederConfigSchema>;
export type ServerConfig = z.infer<typeof ServerSchema>;
export type DefaultsConfig = z.infer<typeof DefaultsSchema>;
export type BudgetConfig = z.infer<typeof BudgetSchema>;
