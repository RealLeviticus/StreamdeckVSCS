import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { fetchState, toggleSwitch } from "../bridge";

const pollers = new Map<string, NodeJS.Timeout>();

@action({ UUID: "com.chairservices.streamdeck-vscs.toggle" })
export class VscsToggleAction extends SingletonAction<Record<string, never>> {
	override async onWillAppear(ev: WillAppearEvent<Record<string, never>>): Promise<void> {
		await this.refresh(ev);
		startPolling(ev.action.id, () => this.refresh(ev));
	}

	override async onKeyDown(ev: KeyDownEvent<Record<string, never>>): Promise<void> {
		try {
			await toggleSwitch("mute");
			await this.refresh(ev);
		} catch (err) {
			await ev.action.setTitle("Error");
			console.error(err);
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<Record<string, never>>): Promise<void> {
		stopPolling(ev.action.id);
	}

	private async refresh(ev: WillAppearEvent<Record<string, never>> | KeyDownEvent<Record<string, never>>) {
		try {
			const state = await fetchState();
			const muted = !!state.toggles.mute;
			const svg = makeMuteSvg(muted);
			await ev.action.setTitle("");
			await ev.action.setImage(`data:image/svg+xml;base64,${btoa(svg)}`);
		} catch (err) {
			await ev.action.setTitle("Error");
			console.error(err);
		}
	}
}

function startPolling(context: string, fn: () => void) {
	stopPolling(context);
	pollers.set(
		context,
		setInterval(() => {
			fn();
		}, 1000)
	);
}

function stopPolling(context: string) {
	if (!pollers.has(context)) return;
	clearInterval(pollers.get(context));
	pollers.delete(context);
}

function makeMuteSvg(muted: boolean): string {
	const bg = "#7e8686";
	const border = muted ? "#EBEB00" : "#7e8686";
	const textColor = "#00196a";
	const line1 = "Coord";
	const line2 = muted ? "MUTE" : "";
	const underline = muted
		? `<line x1="28" y1="96" x2="116" y2="96" stroke="${textColor}" stroke-width="4" />`
		: "";
	return `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect x="4" y="4" width="136" height="136" rx="10" ry="10" fill="${border}" />
  <rect x="8" y="8" width="128" height="128" rx="8" ry="8" fill="${bg}" />
  <text x="50%" y="48%" fill="${textColor}" font-family="Arial" font-size="22" text-anchor="middle" dominant-baseline="middle">${line1}</text>
  <text x="50%" y="68%" fill="${textColor}" font-family="Arial" font-size="20" text-anchor="middle" dominant-baseline="middle">${line2}</text>
  ${underline}
</svg>`;
}
