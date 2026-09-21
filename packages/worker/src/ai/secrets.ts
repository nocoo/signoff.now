import { JevError } from "./jev.js";

const encoder = new TextEncoder();
function bytes(value: string) {
	return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function base64(value: Uint8Array) {
	return btoa(String.fromCharCode(...value));
}
async function encryptionKey(master: string | undefined) {
	try {
		const raw = bytes(master ?? "");
		if (raw.length !== 32) throw new Error();
		return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
			"encrypt",
			"decrypt",
		]);
	} catch {
		throw new JevError(
			"secret_storage",
			"AI secret storage is not configured. Set SIGNOFF_AI_ENCRYPTION_KEY on the Worker.",
		);
	}
}
export async function sealKey(value: string, master: string | undefined) {
	const key = await encryptionKey(master);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: encoder.encode("signoff:jev:v1") },
		key,
		encoder.encode(value),
	);
	return `${base64(iv)}.${base64(new Uint8Array(data))}`;
}
export async function openKey(
	value: string | null,
	master: string | undefined,
) {
	if (!value)
		throw new JevError(
			"missing_key",
			"Configure a Jev API key in AI Settings.",
		);
	const key = await encryptionKey(master);
	try {
		const [iv, data] = value.split(".");
		if (!iv || !data) throw new Error("Invalid encrypted credential");
		return new TextDecoder().decode(
			await crypto.subtle.decrypt(
				{
					name: "AES-GCM",
					iv: bytes(iv),
					additionalData: encoder.encode("signoff:jev:v1"),
				},
				key,
				bytes(data),
			),
		);
	} catch {
		throw new JevError(
			"secret_storage",
			"The saved Jev key cannot be decrypted. Replace it in AI Settings.",
		);
	}
}
