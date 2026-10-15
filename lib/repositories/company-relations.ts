export type CompanyRelationRow = { companyId: string };

export function groupRowsByCompanyId<T extends CompanyRelationRow>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const companyRows = grouped.get(row.companyId);
    if (companyRows) {
      companyRows.push(row);
    } else {
      grouped.set(row.companyId, [row]);
    }
  }
  return grouped;
}
