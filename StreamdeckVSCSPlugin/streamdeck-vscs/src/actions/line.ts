import {
	action,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent
} from "@elgato/streamdeck";
import { fetchState, toggleLine, VscsLine } from "../bridge";

type LineSettings = {
	targetId?: string | null; // manual selection from PI
};

const pollers: Record<string, NodeJS.Timeout> = {};
const settingsByContext: Record<string, LineSettings> = {};

@action({ UUID: "com.chairservices.streamdeck-vscs.line" })
export class VscsLineAction extends SingletonAction<LineSettings> {
	override async onWillAppear(ev: WillAppearEvent<LineSettings>): Promise<void> {
		const ctx = getContext(ev);
		settingsByContext[ctx] = ev.payload.settings ?? {};
		this.startPolling(ctx, ev.action);
		await this.refresh(ctx, ev.action);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<LineSettings>): Promise<void> {
		const ctx = getContext(ev);
		settingsByContext[ctx] = ev.payload.settings ?? {};
		await this.refresh(ctx, ev.action);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<Partial<LineSettings>, LineSettings>): Promise<void> {
		const ctx = getContext(ev);
		const incoming = ev.payload as Partial<LineSettings>;
		if (!incoming) return;
		const next = { ...(settingsByContext[ctx] ?? {}), ...incoming };
		settingsByContext[ctx] = next;
		await ev.action.setSettings(next);
		await this.refresh(ctx, ev.action);
	}

	override async onKeyDown(ev: KeyDownEvent<LineSettings>): Promise<void> {
		const targetId = settingsByContext[getContext(ev)]?.targetId;
		if (!targetId) return;
		try {
			await toggleLine(targetId);
			await this.refresh(getContext(ev), ev.action);
		} catch {
			// ignore
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<LineSettings>): Promise<void> {
		const ctx = getContext(ev);
		if (pollers[ctx]) {
			clearInterval(pollers[ctx]);
			delete pollers[ctx];
		}
		delete settingsByContext[ctx];
	}

	private async refresh(ctx: string, action: any) {
		const targetId = settingsByContext[ctx]?.targetId;
		if (!targetId) {
			await setPlaceholder(action);
			return;
		}

		const lines = await fetchLines();
		const line = lines.linesById[targetId];
		if (!line) {
			await setPlaceholder(action);
			return;
		}

		const label = formatLabel(line);
		const color = chooseColor(line);
		const svg = makeSvg(label, color);
		await action.setTitle(label);
		await action.setImage(`data:image/svg+xml;base64,${btoa(svg)}`);
	}

	private startPolling(ctx: string, action: any) {
		if (pollers[ctx]) clearInterval(pollers[ctx]);
		pollers[ctx] = setInterval(async () => {
			await this.refresh(ctx, action);
		}, 500);
	}
}

async function setPlaceholder(action: any) {
	await action.setTitle("");
	await action.setImage(makeBlankImage());
}

function getContext(ev: { action?: any; context?: string }): string {
	return (ev as any).action?.id || (ev as any).action?.context || (ev as any).context || "";
}

async function fetchLines(): Promise<{ linesById: Record<string, VscsLine> }> {
	const linesById: Record<string, VscsLine> = {};
	try {
		const state = await fetchState();
		(state.lines ?? []).forEach((l) => (linesById[l.id] = l));
	} catch {
		// ignore fetch errors; return whatever we have
	}
	return { linesById };
}

function stationCode(name: string): string {
	const parts = name.split("_");
	if (parts.length >= 2 && parts[1].length >= 3) return parts[1].substring(0, 3).toUpperCase();
	if (parts.length >= 2 && parts[1].length >= 1) return (parts[1][0] + (parts[0][0] || "") + (parts[0][1] || "")).toUpperCase();
	const match = name.match(/^([A-Za-z]{2})_?([A-Za-z])/);
	if (match) return (match[1] + match[2]).toUpperCase();
	return name.split("_")[0]?.slice(0, 3).toUpperCase() || name.toUpperCase();
}

function friendlyName(name: string): string {
	return name
		.replace(/_/g, " ")
		.split(" ")
		.map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
		.join(" ")
		.trim();
}

function formatLabel(line: VscsLine): string {
	const station = stationCode(line.name);
	const friendly = friendlyName(line.name);
	return `${station}\n${friendly}\n${line.state}`;
}

function chooseColor(line: VscsLine): string {
	const baseHot = "#EBEB00";
	const baseCold = "#00EBEB";
	const baseMonitor = "#4ca66a";
	const activeGreen = "#3cb371"; // matches the in-app "open" feel
	const purpleRing = "#8f42d1";

	const state = (line.state || "").toLowerCase();
	const type = (line.type || "").toLowerCase();
	const isActive = state === "open" || state === "outbound" || state === "inbound";
	const base = type === "hotline" ? baseHot : type === "coldline" ? baseCold : baseMonitor;

	// Coldline rings purple until picked up.
	if (type === "coldline" && state === "inbound") {
		const flash = (Date.now() % 800) < 400;
		return flash ? lighten(purpleRing, 0.2) : darken(purpleRing, 0.2);
	}

	// Hotlines go green as soon as they go active.
	if (type === "hotline" && isActive) {
		return activeGreen;
	}

	// Coldlines go green once answered/active.
	if (type === "coldline" && (state === "open" || state === "outbound")) {
		return activeGreen;
	}

	// Other lines still flash when inbound.
	if (state === "inbound") {
		const flash = (Date.now() % 1000) < 500;
		return flash ? lighten(base, 0.2) : darken(base, 0.15);
	}

	return base;
}

function makeSvg(label: string, color: string): string {
	const [line1 = "", line2 = "", line3 = ""] = label.split("\n");
	return `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="12" ry="12" fill="${color}"/>
  <text x="50%" y="38%" fill="white" font-family="Arial" font-size="20" text-anchor="middle">${escapeXml(line1)}</text>
  <text x="50%" y="58%" fill="white" font-family="Arial" font-size="18" text-anchor="middle">${escapeXml(line2)}</text>
  <text x="50%" y="78%" fill="white" font-family="Arial" font-size="16" text-anchor="middle">${escapeXml(line3)}</text>
</svg>`;
}

function makeBlankImage(): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="12" ry="12" fill="#000000"/></svg>`;
	return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function escapeXml(s: string): string {
	return s.replace(/[<>&'"]/g, (c) => {
		switch (c) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case "'":
				return "&apos;";
			case "\"":
				return "&quot;";
			default:
				return c;
		}
	});
}

function lighten(color: string, amount: number): string {
	const { r, g, b } = parseColor(color);
	return toColor({ r: clamp(r + 255 * amount), g: clamp(g + 255 * amount), b: clamp(b + 255 * amount) });
}

function darken(color: string, amount: number): string {
	const { r, g, b } = parseColor(color);
	return toColor({ r: clamp(r - 255 * amount), g: clamp(g - 255 * amount), b: clamp(b - 255 * amount) });
}

function parseColor(color: string): { r: number; g: number; b: number } {
	const hex = color.replace("#", "");
	const bigint = parseInt(hex, 16);
	return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function toColor(c: { r: number; g: number; b: number }): string {
	return "#" + ((1 << 24) + (clamp(c.r) << 16) + (clamp(c.g) << 8) + clamp(c.b)).toString(16).slice(1);
}

function clamp(v: number): number {
	return Math.max(0, Math.min(255, Math.round(v)));
}
