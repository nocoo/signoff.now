/** Bootstrap read: one D1 batch for a consistent snapshot. */

export type BootstrapSettingsRow = {
	key: string;
	value: string;
	updated_at: number;
};

export function bootstrapSnapshotStatements(
	db: D1Database,
): D1PreparedStatement[] {
	return [
		db.prepare("SELECT key, value, updated_at FROM settings"),
		db.prepare(
			`SELECT id, name, alias FROM developers
       WHERE archived_at IS NULL ORDER BY name`,
		),
		db.prepare(
			`SELECT id, provider, org, project, name, external_id, project_external_id, enabled
       FROM repos WHERE archived_at IS NULL AND enabled = 1
       ORDER BY org, project, name`,
		),
	];
}
