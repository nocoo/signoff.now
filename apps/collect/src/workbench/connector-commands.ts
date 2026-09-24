import { type Command, CommanderError } from "commander";
import {
	type ConnectorDeps,
	connectorLogin,
	connectorLogout,
	connectorStatus,
	defaultConnectorDeps,
} from "./connector.ts";

type Print = (value: unknown, command: Command) => void;

/** `signoff connector login | status | logout` */
export function registerConnectorCommands(
	program: Command,
	print: Print,
	makeDeps: () => ConnectorDeps = defaultConnectorDeps,
) {
	const connector = program
		.command("connector")
		.description("Connect this machine to a deployed SignOff site");
	connector
		.command("login")
		.description("Sign in through the browser and save a connector token")
		.option("--server <origin>", "SignOff site", "https://signoff.hexly.ai")
		.option("--name <name>", "Name shown in SignOff (defaults to host name)")
		.action(async (_opts, command: Command) => {
			const { server, name } = command.opts() as {
				server: string;
				name?: string;
			};
			const { config, me } = await connectorLogin({ server, name }, makeDeps());
			print(
				{
					connectorId: config.connectorId,
					owner: config.owner,
					server: config.webOrigin,
					expiresAt: new Date(config.expiresAt * 1000).toISOString(),
					projects: me.projects,
					next: me.projects.length
						? "Run: signoff daemon"
						: "Ask an administrator to make you the data owner of a project, then run: signoff daemon",
				},
				command,
			);
		});
	connector
		.command("status")
		.description("Show the saved connector and whether SignOff accepts it")
		.action(async (_opts, command: Command) => {
			const status = await connectorStatus(makeDeps());
			print(
				status.state === "ready"
					? {
							state: status.state,
							connectorId: status.config.connectorId,
							owner: status.config.owner,
							server: status.config.webOrigin,
							expiresAt: new Date(status.config.expiresAt * 1000).toISOString(),
							projects: status.me.projects,
							config: status.path,
						}
					: {
							state: status.state,
							config: status.path,
							next: "Run: signoff connector login",
						},
				command,
			);
			if (status.state !== "ready")
				throw new CommanderError(
					1,
					"signoff.connector",
					status.state === "signed_out"
						? "No connector is signed in"
						: `Connector token is ${status.state}`,
				);
		});
	connector
		.command("logout")
		.description("Forget the saved connector token on this machine")
		.action(async (_opts, command: Command) => {
			print({ removed: connectorLogout(makeDeps()) }, command);
		});
}
