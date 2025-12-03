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

const ROLE_TOKENS = new Set(["CTR", "CENTER", "CENTRE", "APP", "APCH", "APPROACH", "DEP", "DEPARTURE", "TWR", "TOWER", "ACC", "AREA"]);
const GROUND_TOKENS = new Set(["GND", "GROUND", "GRND"]);
const LOCATION_ALIASES: Record<string, { code?: string; label?: string }> = {
	MUN: { code: "MUN", label: "Mungo" },
	SY: { label: "Sydney" }
};

type LineSettings = {
	targetId?: string | null; // manual selection from PI
	autoAssignId?: string | null; // numeric "slot" chosen in PI for auto-mapping
	mode?: "auto" | "manual";
};

const pollers: Record<string, NodeJS.Timeout> = {};
const settingsByContext: Record<string, LineSettings> = {};
const resolvedTargetsByContext: Record<string, string | undefined> = {};
const autoAssignments: Record<string, string> = {}; // slot -> line id
const TITLE_COLOR = "#000060"; // desired vatSys-like deep blue
const TITLE_COLOR_HI = "#FFFFFF"; // bright fallback for dark flashing

@action({ UUID: "com.leviticus.streamdeck-vscs.line" })
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
		const incoming = ev.payload as Partial<LineSettings> & { type?: string };
		if (!incoming) return;

		if (incoming.type === "requestOptions") {
			await sendOptionsToPi(ev);
			return;
		}

		const next = mergeSettings(settingsByContext[ctx], incoming);
		settingsByContext[ctx] = next;
		await ev.action.setSettings(next);
		await this.refresh(ctx, ev.action);
	}

	override async onKeyDown(ev: KeyDownEvent<LineSettings>): Promise<void> {
		const targetId = resolvedTargetsByContext[getContext(ev)] ?? settingsByContext[getContext(ev)]?.targetId;
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
		// Keep settings cached so auto-assign IDs from other pages still participate in ordering.
		delete resolvedTargetsByContext[ctx];
	}

	private async refresh(ctx: string, action: any) {
		const settings = settingsByContext[ctx] ?? {};
		const { list: lines, linesById } = await fetchLines();
		updateAutoAssignments(lines);

		const targetId = resolveTargetId(settings, linesById);
		resolvedTargetsByContext[ctx] = targetId ?? undefined;
		if (!targetId) {
			await setPlaceholder(action);
			return;
		}

		const line = linesById[targetId];
		if (!line) {
			await setPlaceholder(action);
			return;
		}

		const label = formatLabel(line);
		const color = chooseColor(line);
		const textColor = pickTextColor(line);
		const svg = makeSvg(label, color, textColor);
		await action.setTitle("");
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

async function fetchLines(): Promise<{ list: VscsLine[]; linesById: Record<string, VscsLine> }> {
	const linesById: Record<string, VscsLine> = {};
	let list: VscsLine[] = [];
	try {
		const state = await fetchState();
		list = state.lines ?? [];
		list.forEach((l) => (linesById[l.id] = l));
	} catch {
		// ignore fetch errors; return whatever we have
	}
	return { list, linesById };
}

function resolveTargetId(settings: LineSettings, linesById: Record<string, VscsLine>): string | undefined {
	const mode = resolveMode(settings);
	if (mode === "manual") {
		const manual = settings.targetId ?? undefined;
		if (manual && linesById[manual]) return manual;
		return undefined;
	}
	const slot = settings.autoAssignId ?? undefined;
	if (!slot) return undefined;
	const assigned = autoAssignments[slot];
	if (assigned && linesById[assigned]) return assigned;
	return undefined;
}

function stationCode(name: string): string {
	const tokens = wordsFromName(name).map((w) => w.toUpperCase());
	if (!tokens.length) return "";

	// Pattern: prefix + location + role (e.g., ML MUN CTR).
	if (tokens.length >= 3 && ROLE_TOKENS.has(tokens[tokens.length - 1])) {
		const location = pickLocation(tokens);
		const alias = LOCATION_ALIASES[location];
		if (alias?.code) return alias.code;
		return location.slice(0, 3);
	}

	// Ground-only naming (e.g., SY GND).
	if (tokens.length === 2 && GROUND_TOKENS.has(tokens[1])) {
		return `${tokens[0]} SMC`;
	}

	// Multi-word: use initials of first three words (e.g., Sydney Approach North -> SAN).
	if (tokens.length >= 3) {
		return tokens.slice(0, 3).map((w) => (w[0] || "")).join("");
	}

	if (tokens.length === 2) return `${tokens[0]} ${tokens[1]}`;
	return (tokens[0] || "").slice(0, 3);
}

function friendlyName(name: string): string {
	const tokens = wordsFromName(name).map((w) => w.toUpperCase());
	if (!tokens.length) return "";

	// If role present at end, show the location only.
	if (tokens.length >= 2 && ROLE_TOKENS.has(tokens[tokens.length - 1])) {
		const location = pickLocation(tokens);
		return prettifyLocation(location, tokens[tokens.length - 1]);
	}

	// Ground: show "<Location> Gr".
	if (tokens.length === 2 && GROUND_TOKENS.has(tokens[1])) {
		return `${prettifyLocation(tokens[0])} Gr`;
	}

	return tokens.map((w) => toTitle(w)).join(" ").trim();
}

function formatLabel(line: VscsLine): string {
	const station = stationCode(line.name);
	const friendly = friendlyName(line.name);
	return `${station}\n${friendly}`;
}

function chooseColor(line: VscsLine): string {
	const baseHot = "#EBEB00"; // idle hotline
	const baseCold = "#00c8d8"; // idle coldline
	const baseMonitor = "#4ca66a";
	const activeGreen = "#00c900";
	const coldPurple = "#5B447A";
	const state = (line.state || "").toLowerCase();
	const type = (line.type || "").toLowerCase();
	const isHotActive = state === "open" || state === "outbound" || state === "inbound";
	const isColdActive = state === "open";
	const isColdPending = state === "inbound" || state === "outbound";

	if (type === "coldline") {
		if (isColdPending) {
			const flash = (Date.now() % 800) < 400;
			return flash ? coldPurple : baseCold;
		}
		if (isColdActive) return coldPurple;
		return baseCold;
	}

	if (type === "hotline") {
		if (isHotActive) return activeGreen;
		return baseHot;
	}

	// other lines / monitors
	if (state === "inbound") {
		const flash = (Date.now() % 1000) < 500;
		return flash ? baseCold : darken(baseCold, 0.2);
	}
	return baseMonitor;
}

function makeSvg(label: string, color: string, textColor: string): string {
	const [line1 = "", line2 = "", line3 = ""] = label.split("\n");
	const hasThird = !!line3;
	const font1 = 26;
	const font2 = 20;
	const font3 = 16;
	const y1 = hasThird ? -12 : -6;
	const y2 = hasThird ? 12 : 14;
	const y3 = 36;
	return `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect width="144" height="144" rx="12" ry="12" fill="${color}"/>
  <g transform="translate(72 72)">
    <text x="0" y="${y1}" fill="${textColor}" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="${font1}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeXml(line1)}</text>
    <text x="0" y="${y2}" fill="${textColor}" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="${font2}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeXml(line2)}</text>
    ${hasThird ? `<text x="0" y="${y3}" fill="${textColor}" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="${font3}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeXml(line3)}</text>` : ""}
  </g>
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

function wordsFromName(name: string): string[] {
	return (name || "")
		.replace(/[_-]+/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

function pickLocation(tokens: string[]): string {
	if (!tokens.length) return "";
	if (tokens.length >= 2 && ROLE_TOKENS.has(tokens[tokens.length - 1])) {
		const candidate = tokens[tokens.length - 2];
		if (candidate) return candidate;
	}
	return tokens[0] || "";
}

function prettifyLocation(location: string, role?: string): string {
	if (!location) return "";
	const alias = LOCATION_ALIASES[location];
	if (alias?.label) return alias.label;
	if (role && GROUND_TOKENS.has(role)) return `${toTitle(location)} Gr`;
	return toTitle(location);
}

function toTitle(value: string): string {
	if (!value) return "";
	return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

function pickTextColor(line: VscsLine): string {
	const state = (line.state || "").toLowerCase();
	const type = (line.type || "").toLowerCase();
	const isColdPending = type === "coldline" && (state === "inbound" || state === "outbound");
	const isColdActive = type === "coldline" && state === "open";
	if (isColdPending || isColdActive) return TITLE_COLOR_HI;
	return TITLE_COLOR;
}
function resolveMode(settings: LineSettings | undefined): "auto" | "manual" {
	if (settings?.mode === "auto" || settings?.mode === "manual") return settings.mode;
	if (settings?.autoAssignId) return "auto";
	return "auto";
}

function mergeSettings(current: LineSettings | undefined, incoming: Partial<LineSettings>): LineSettings {
	const next: LineSettings = { ...(current ?? {}) };
	if ("targetId" in incoming) next.targetId = incoming.targetId ?? null;
	if ("autoAssignId" in incoming) next.autoAssignId = incoming.autoAssignId ?? null;
	if ("mode" in incoming && (incoming.mode === "auto" || incoming.mode === "manual")) next.mode = incoming.mode;
	return next;
}

function updateAutoAssignments(lines: VscsLine[]): void {
	if (!lines || !Array.isArray(lines)) return;
	const desiredSlots = getActiveAutoSlots();
	const sortedSlots = [...desiredSlots].sort(sortSlots);
	const orderedLines = orderLines(lines);

	// Rebuild assignments fresh each cycle so hotlines stay grouped ahead of coldlines.
	const newAssignments: Record<string, string> = {};
	const used = new Set<string>();
	for (const slot of sortedSlots) {
		const nextLine = orderedLines.find((l) => !used.has(l.id));
		if (!nextLine) break;
		used.add(nextLine.id);
		newAssignments[slot] = nextLine.id;
	}

	// Replace map in-place to avoid stale slots.
	for (const key of Object.keys(autoAssignments)) delete autoAssignments[key];
	for (const [slot, lineId] of Object.entries(newAssignments)) {
		autoAssignments[slot] = lineId;
	}
}

function getActiveAutoSlots(): string[] {
	const slots = new Set<string>();
	Object.values(settingsByContext).forEach((s) => {
		if (resolveMode(s) !== "auto") return;
		const slot = (s.autoAssignId ?? "").toString().trim();
		if (slot) slots.add(slot);
	});
	return [...slots];
}

function orderLines(lines: VscsLine[]): VscsLine[] {
	return [...lines].sort((a, b) => {
		const diff = linePriority(a) - linePriority(b);
		if (diff !== 0) return diff;
		return friendlyName(a.name).localeCompare(friendlyName(b.name));
	});
}

function linePriority(line: VscsLine): number {
	const type = (line.type || "").toLowerCase();
	if (type.includes("hot")) return 0;
	if (type.includes("cold")) return 1;
	return 2;
}

function sortSlots(a: string, b: string): number {
	const na = parseInt(a, 10);
	const nb = parseInt(b, 10);
	const aNum = !Number.isNaN(na);
	const bNum = !Number.isNaN(nb);
	if (aNum && bNum && na !== nb) return na - nb;
	if (aNum && !bNum) return -1;
	if (!aNum && bNum) return 1;
	return a.localeCompare(b);
}

async function sendOptionsToPi(ev: SendToPluginEvent<any, LineSettings>): Promise<void> {
	const sender = (ev.action as any)?.sendToPropertyInspector as ((payload: unknown) => Promise<void>) | undefined;
	if (!sender) return;
	try {
		const { list } = await fetchLines();
		const options = orderLines(list).map((line) => ({
			id: line.id,
			label: `${stationCode(line.name)} - ${friendlyName(line.name)}`,
			detail: [line.type || "Line"].filter(Boolean).join(" / "),
			type: line.type || "Line"
		}));
		await sender.call(ev.action, { type: "options", options });
	} catch {
		// ignore option push errors
	}
}
