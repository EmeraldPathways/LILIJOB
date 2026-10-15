import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sectorPitches } from "../../db/schema-v4";

export async function saveSectorPitch(ownerId: string, input: { profileId?: string | null; sector: string; companyName: string; role: string; payload: unknown }) {
  const [last] = await getDb().select({ version: sectorPitches.version }).from(sectorPitches).where(and(eq(sectorPitches.ownerId, ownerId), eq(sectorPitches.sector, input.sector), eq(sectorPitches.companyName, input.companyName), eq(sectorPitches.role, input.role))).orderBy(desc(sectorPitches.version)).limit(1);
  const timestamp = new Date().toISOString();
  const id = `sector_pitch_${crypto.randomUUID()}`;
  const version = (last?.version ?? 0) + 1;
  await getDb().insert(sectorPitches).values({ id, ownerId, profileId: input.profileId ?? null, sector: input.sector, companyName: input.companyName, role: input.role, payloadJson: JSON.stringify(input.payload), version, createdAt: timestamp, updatedAt: timestamp });
  const [saved] = await getDb().select().from(sectorPitches).where(and(eq(sectorPitches.ownerId, ownerId), eq(sectorPitches.id, id))).limit(1);
  return saved ?? null;
}

export async function listSectorPitches(ownerId: string) {
  return getDb().select().from(sectorPitches).where(eq(sectorPitches.ownerId, ownerId)).orderBy(desc(sectorPitches.updatedAt));
}

export async function getSectorPitch(ownerId: string, pitchId: string) {
  const [pitch] = await getDb().select().from(sectorPitches).where(and(eq(sectorPitches.ownerId, ownerId), eq(sectorPitches.id, pitchId))).limit(1);
  return pitch ?? null;
}

export async function saveSectorPitchRevision(ownerId: string, pitchId: string, payload: unknown) {
  const existing = await getSectorPitch(ownerId, pitchId);
  if (!existing) return null;
  return saveSectorPitch(ownerId, {
    profileId: existing.profileId,
    sector: existing.sector,
    companyName: existing.companyName,
    role: existing.role,
    payload,
  });
}
