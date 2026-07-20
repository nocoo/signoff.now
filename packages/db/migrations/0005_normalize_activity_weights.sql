-- 0005_normalize_activity_weights.sql
-- One-shot compatibility: clamp activity_weights values to non-negative integers.
-- Pre-05 data may have contained floats; 05 freezes int + nonnegative weights.
-- Keys contain dots (e.g. pr.merged) — use quoted JSON paths.
-- Safe no-op when all values already satisfy the rule (typical seed).

UPDATE settings
SET
	value = json_set(
		json_set(
			json_set(
				json_set(
					json_set(
						json_set(
							json_set(
								json_set(
									COALESCE(value, '{}'),
									'$."pr.merged"',
									MAX(
										0,
										CAST(
											ROUND(
												COALESCE(
													CAST(json_extract(value, '$."pr.merged"') AS REAL),
													10
												)
											) AS INTEGER
										)
									)
								),
								'$."pr.closed"',
								MAX(
									0,
									CAST(
										ROUND(
											COALESCE(
												CAST(json_extract(value, '$."pr.closed"') AS REAL),
												2
											)
										) AS INTEGER
									)
								)
							),
							'$."pr.created"',
							MAX(
								0,
								CAST(
									ROUND(
										COALESCE(
											CAST(json_extract(value, '$."pr.created"') AS REAL),
											2
										)
									) AS INTEGER
								)
							)
						),
						'$."pr.vote"',
						MAX(
							0,
							CAST(
								ROUND(
									COALESCE(CAST(json_extract(value, '$."pr.vote"') AS REAL), 3)
								) AS INTEGER
							)
						)
					),
					'$."pr.active"',
					MAX(
						0,
						CAST(
							ROUND(
								COALESCE(CAST(json_extract(value, '$."pr.active"') AS REAL), 2)
							) AS INTEGER
						)
					)
				),
				'$."wi.created"',
				MAX(
					0,
					CAST(
						ROUND(
							COALESCE(
								CAST(json_extract(value, '$."wi.created"') AS REAL),
								3
							)
						) AS INTEGER
					)
				)
			),
			'$."wi.updated"',
			MAX(
				0,
				CAST(
					ROUND(
						COALESCE(
							CAST(json_extract(value, '$."wi.updated"') AS REAL),
							1
						)
					) AS INTEGER
				)
			)
		),
		'$."wi.closed"',
		MAX(
			0,
			CAST(
				ROUND(
					COALESCE(CAST(json_extract(value, '$."wi.closed"') AS REAL), 5)
				) AS INTEGER
			)
		)
	),
	updated_at = unixepoch()
WHERE
	key = 'activity_weights';
