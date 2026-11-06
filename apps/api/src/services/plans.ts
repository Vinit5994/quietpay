import { and, desc, eq } from "drizzle-orm";
import { parseEventLogs } from "viem";
import { fromUnits, quietPayAbi, toUnits, type BodyOf, type Plan } from "@quietpay/shared";
import { plans } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { ApiError, notFound } from "../lib/errors";
import { isoFromSeconds, newId, nowSeconds } from "../lib/ids";
import type { Relayer } from "../relayer";
import { MIN_AMOUNT_UNITS } from "./sessions";

export type PlanRow = typeof plans.$inferSelect;

const DAY = 86_400;
export const PERIODS = { month: 30 * DAY, week: 7 * DAY } as const;
export const DEFAULT_GRACE = 3 * DAY;
export const DEMO_GRACE = 60;

/** Period and grace for a new plan. DEMO_PERIOD_OVERRIDE (e.g. 120) forces short periods for the demo. */
export function planTiming(deps: Deps, body: BodyOf<"createPlan">) {
  const override = deps.env.DEMO_PERIOD_OVERRIDE;
  const period = override ?? (body.interval === "custom" ? body.periodSeconds! : PERIODS[body.interval]);
  const grace = body.graceSeconds ?? (override ? DEMO_GRACE : DEFAULT_GRACE);
  if (period < 60 || period > 0xffffffff || grace > 0xffffffff) throw new ApiError(400, "bad_request", "Period must be at least 60 seconds.");
  return { period, grace };
}

export function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    onchainPlanId: row.onchainPlanId,
    name: row.name,
    amount: fromUnits(BigInt(row.amountUnits)),
    interval: row.interval,
    periodSeconds: row.periodSeconds,
    graceSeconds: row.graceSeconds,
    active: row.active,
    createdAt: isoFromSeconds(row.createdAt),
  };
}

/** Creates the plan on-chain (operator `createPlan`, waits for the receipt) and stores it. */
export async function createPlan(deps: Deps, relayer: Relayer, merchant: MerchantRow, body: BodyOf<"createPlan">): Promise<PlanRow> {
  const amount = toUnits(body.amount);
  if (amount < MIN_AMOUNT_UNITS) {
    throw new ApiError(422, "amount_below_minimum", `Minimum plan amount is ${fromUnits(MIN_AMOUNT_UNITS)} USDT.`);
  }
  const { period, grace } = planTiming(deps, body);

  const { receipt } = await relayer.relayAndWait({
    fn: "createPlan",
    args: [BigInt(merchant.onchainId), amount, period, grace],
    merchant,
    purpose: "admin",
  });
  const [created] = parseEventLogs({ abi: quietPayAbi, eventName: "PlanCreated", logs: receipt.logs });
  if (!created) throw new ApiError(500, "transaction_failed", "PlanCreated event missing from the receipt.");

  const row: PlanRow = {
    id: newId("plan"),
    merchantId: merchant.id,
    onchainPlanId: created.args.planId.toString(),
    name: body.name,
    amountUnits: amount.toString(),
    interval: body.interval,
    periodSeconds: period,
    graceSeconds: grace,
    active: true,
    createdAt: nowSeconds(),
  };
  deps.db.insert(plans).values(row).run();
  return row;
}

export function listPlans(deps: Deps, merchantId: string) {
  return deps.db.select().from(plans).where(eq(plans.merchantId, merchantId)).orderBy(desc(plans.createdAt)).all();
}

export function loadPlan(deps: Deps, merchantId: string, planId: string): PlanRow {
  const row = deps.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.merchantId, merchantId))).get();
  if (!row) throw notFound("Plan");
  return row;
}

export const planByOnchainId = (deps: Deps, onchainPlanId: string) =>
  deps.db.select().from(plans).where(eq(plans.onchainPlanId, onchainPlanId)).get();

export const planById = (deps: Deps, id: string) => deps.db.select().from(plans).where(eq(plans.id, id)).get();
