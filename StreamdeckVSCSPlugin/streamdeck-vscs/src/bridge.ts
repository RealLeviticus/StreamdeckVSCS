export type VscsState = {
	frequencies: VscsFrequency[];
	lines: VscsLine[];
	toggles: {
		group: boolean;
		allSpeaker: boolean;
		tonesSpeaker: boolean;
		mute: boolean;
		atisReceive: boolean;
	};
	networkValid: boolean;
	error?: string;
};

export type VscsFrequency = {
	id: string;
	name: string;
	frequency: number;
	receive: boolean;
	transmit: boolean;
	friendlyName?: string;
};

export type VscsLine = {
	id: string;
	name: string;
	type: string;
	state: string;
	external: boolean;
	color?: string;
};

const BASE = "http://127.0.0.1:18084";

async function http<T>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(options.headers ?? {})
		}
	});

	if (!res.ok) {
		const msg = await res.text();
		throw new Error(`Bridge error ${res.status}: ${msg}`);
	}

	if (res.status === 204) return undefined as unknown as T;
	return (await res.json()) as T;
}

export async function fetchState(): Promise<VscsState> {
	return http<VscsState>("/state");
}

export async function setFrequencyMode(id: string, mode: "off" | "rx" | "tx"): Promise<void> {
	await http(`/freq/${encodeURIComponent(id)}/mode`, { method: "POST", body: JSON.stringify(mode) });
}

export async function removeFrequency(id: string): Promise<void> {
	await http(`/freq/${encodeURIComponent(id)}/remove`, { method: "POST" });
}

export async function toggleLine(id: string): Promise<void> {
	await http(`/line/${encodeURIComponent(id)}/toggle`, { method: "POST" });
}

export async function toggleSwitch(target: "group" | "allspeaker" | "tonesspeaker" | "mute" | "atis"): Promise<void> {
	await http(`/toggle/${target}`, { method: "POST" });
}
