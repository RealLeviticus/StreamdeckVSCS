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
	const border = muted ? "#ebeb00" : "#0076ff";
	const textPrimary = "#0b1f73";
	const textSecondary = muted ? "#ebeb00" : "#f7f7f7";
	const line1 = "COORD";
	const line2 = muted ? "MUTE" : "LIVE";
	return `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <rect x="6" y="6" width="132" height="132" rx="16" ry="16" fill="${bg}" stroke="${border}" stroke-width="8"/>
  <text x="50%" y="50%" fill="${textPrimary}" font-family="Arial" font-size="30" font-weight="bold" text-anchor="middle" dominant-baseline="central">${line1}</text>
  <text x="50%" y="74%" fill="${textSecondary}" font-family="Arial" font-size="24" font-weight="bold" text-anchor="middle" dominant-baseline="central">${line2}</text>
</svg>`;
}
