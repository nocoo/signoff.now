import { Badge, Button, Field, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import { ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { AlertBanner } from "@/components/AlertBanner";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { useAdminViewModel } from "@/viewmodels/useAdminViewModel";

function AddForm({
	label,
	busy,
	onAdd,
}: {
	label: string;
	busy: boolean;
	onAdd: (value: string) => Promise<boolean>;
}) {
	const [value, setValue] = useState("");
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (value.trim() && (await onAdd(value))) setValue("");
	};
	return (
		<form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
			<Field label={label} className="w-full max-w-sm">
				<Input
					value={value}
					placeholder="name@example.com or service:<client id>"
					onChange={(event) => setValue(event.target.value)}
					disabled={busy}
				/>
			</Field>
			<Button type="submit" disabled={busy || !value.trim()}>
				<UserPlus className="h-4 w-4" aria-hidden strokeWidth={1.5} />
				Add
			</Button>
		</form>
	);
}

const date = (seconds: number | null) =>
	seconds === null ? "—" : new Date(seconds * 1000).toLocaleDateString();

export function AdminPage() {
	const vm = useAdminViewModel();
	const data = vm.directory.data;
	return (
		<div className="space-y-4">
			<PageHeader
				title="Administration"
				description="Tenants, their members and administrators. Members see shared data in their tenant."
			/>
			{vm.error || vm.directory.error ? (
				<AlertBanner variant="error">
					{vm.error ?? vm.directory.error}
				</AlertBanner>
			) : null}
			{!data ? (
				<LayerCard className="space-y-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-9 w-full max-w-sm" />
				</LayerCard>
			) : (
				<>
					{data.tenants.map((tenant) => (
						<LayerCard key={tenant.id} className="space-y-3">
							<div className="flex items-center gap-2">
								<h2 className="text-sm font-semibold">{tenant.name}</h2>
								<Badge variant="secondary">
									{tenant.members.length} members
								</Badge>
							</div>
							<AddForm
								label="Add member"
								busy={vm.busy !== null}
								onAdd={(member) => vm.addMember(tenant.id, member)}
							/>
							{tenant.members.length ? (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Member</TableHead>
											<TableHead>Added by</TableHead>
											<TableHead>Added</TableHead>
											<TableHead className="w-24 text-right">Action</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{tenant.members.map((member) => (
											<TableRow key={member.principal}>
												<TableCell className="font-medium">
													{member.principal}
												</TableCell>
												<TableCell>{member.addedBy}</TableCell>
												<TableCell>{date(member.addedAt)}</TableCell>
												<TableCell className="text-right">
													<Button
														variant="ghost"
														size="sm"
														disabled={vm.busy !== null}
														onClick={() =>
															void vm.removeMember(tenant.id, member.principal)
														}
														aria-label={`Remove ${member.principal}`}
													>
														<UserMinus
															className="h-4 w-4"
															aria-hidden
															strokeWidth={1.5}
														/>
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							) : (
								<EmptyState
									compact
									icon={UserPlus}
									title="No members yet"
									description="Add the people who should see this tenant's data."
								/>
							)}
						</LayerCard>
					))}
					<LayerCard className="space-y-3">
						<h2 className="text-sm font-semibold">Administrators</h2>
						<AddForm
							label="Add administrator"
							busy={vm.busy !== null}
							onAdd={vm.addAdmin}
						/>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Administrator</TableHead>
									<TableHead>Source</TableHead>
									<TableHead>Added</TableHead>
									<TableHead className="w-24 text-right">Action</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.admins.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={4}
											className="text-basalt-muted-foreground"
										>
											No administrators yet. Permanent administrators come from
											the SIGNOFF_ADMIN_EMAILS secret.
										</TableCell>
									</TableRow>
								) : null}
								{data.admins.map((admin) => (
									<TableRow key={admin.principal}>
										<TableCell className="font-medium">
											<span className="inline-flex items-center gap-1.5">
												<ShieldCheck
													className="h-4 w-4 text-basalt-primary"
													aria-hidden
													strokeWidth={1.5}
												/>
												{admin.principal}
											</span>
										</TableCell>
										<TableCell>
											{admin.source === "environment"
												? "Environment"
												: `Added by ${admin.createdBy}`}
										</TableCell>
										<TableCell>{date(admin.createdAt)}</TableCell>
										<TableCell className="text-right">
											{admin.source === "database" ? (
												<Button
													variant="ghost"
													size="sm"
													disabled={vm.busy !== null}
													onClick={() => void vm.removeAdmin(admin.principal)}
													aria-label={`Remove administrator ${admin.principal}`}
												>
													<UserMinus
														className="h-4 w-4"
														aria-hidden
														strokeWidth={1.5}
													/>
												</Button>
											) : null}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</LayerCard>
				</>
			)}
		</div>
	);
}
