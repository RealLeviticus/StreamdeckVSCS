import { action, KeyDownEvent, SendToPluginEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { fetchState, setFrequencyMode, VscsFrequency } from "../bridge";

type FrequencySettings = {
	targetId?: string;
};

@action({ UUID: "com.chairservices.streamdeck-vscs.frequency" })
export class VscsFrequencyAction extends SingletonAction<FrequencySettings> {
	override async onWillAppear(ev: WillAppearEvent<FrequencySettings>): Promise<void> {
		await this.refreshTitle(ev);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<any, FrequencySettings>): Promise<void> {
		const next = { ...(ev.payload.settings ?? {}), ...(ev.payload.payload as Partial<FrequencySettings>) };
		await ev.action.setSettings(next);
	}

	override async onKeyDown(ev: KeyDownEvent<FrequencySettings>): Promise<void> {
		const { targetId } = ev.payload.settings;
		if (!targetId) {
			await ev.action.setTitle("Pick\nVSCS");
			return;
		}

		try {
			const state = await fetchState();
			const freq = findFrequency(state.frequencies, targetId);
			if (!freq) {
				await ev.action.setTitle("Missing");
				return;
			}

			const nextMode = computeNextMode(freq);
			await setFrequencyMode(targetId, nextMode);
			await this.refreshTitle(ev);
		} catch (err) {
			await ev.action.setTitle("Error");
			console.error(err);
		}
	}

	private async refreshTitle(ev: WillAppearEvent<FrequencySettings> | KeyDownEvent<FrequencySettings>) {
		const { targetId } = ev.payload.settings;
		if (!targetId) {
			await ev.action.setTitle("Pick\nVSCS");
			return;
		}

		try {
			const state = await fetchState();
			const freq = findFrequency(state.frequencies, targetId);
			if (!freq) {
				await ev.action.setTitle("Missing");
				return;
			}

			const label = formatFrequency(freq);
			await ev.action.setTitle(label);
		} catch (err) {
			await ev.action.setTitle("Error");
			console.error(err);
		}
	}
}

function findFrequency(list: VscsFrequency[], id: string): VscsFrequency | undefined {
	return list.find((f) => f.id === id || f.frequency.toString() === id);
}

function computeNextMode(freq: VscsFrequency): "off" | "rx" | "tx" {
	if (freq.transmit && freq.receive) return "off";
	if (freq.receive) return "tx";
	return "rx";
}

function formatFrequency(freq: VscsFrequency): string {
	const mhz = (freq.frequency / 1000).toFixed(3);
	const state = freq.transmit ? "TX" : freq.receive ? "RX" : "OFF";
	return `${freq.name || mhz}\n${mhz}\n${state}`;
}
